/**
 * ClaudeSdkAgentService — concrete RemoteAgentService using @anthropic-ai/claude-agent-sdk.
 *
 * @see ../HARNESS_GUIDE.md — end-to-end guide for implementing a new harness
 *
 * Spawns an in-process Claude Code agent via query(), streams SDKMessage events
 * through ClaudeSdkStreamAdapter, and uses a lightweight keeper child process so
 * PID-based lifecycle management in the daemon continues to work.
 */

import type { ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import type { Query, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { Effect } from 'effect';

import { buildAgentLogPrefix, formatAgentLogLine } from '../agent-log-format.js';
import { BaseCLIAgentService, type CLIAgentServiceDeps } from '../base-cli-agent-service.js';
import { CLAUDE_FALLBACK_MODELS, fetchClaudeModels } from '../claude/claude-models.js';
import { DetectionResult } from '../detection-result.js';
import type {
  AgentStopOptions,
  DaemonHarnessSessionContext,
  SpawnContext,
  SpawnOptions,
  SpawnResult,
  VersionInfo,
  HarnessSessionIdUpdatedInfo,
} from '../remote-agent-service.js';
import { wireNativeStreamAdapter } from '../wire-native-stream-adapter.js';
import { withTimeout } from '../with-timeout.js';
import {
  formatClaudeSdkLoadError,
  getBundledClaudeSdkVersion,
  importBundledClaudeSdk,
  resolvePathToClaudeCodeExecutable,
} from './claude-sdk-package.js';
import { ClaudeSdkStreamAdapter } from './claude-sdk-stream-adapter.js';

type LoadedClaudeSdk = Awaited<ReturnType<typeof importBundledClaudeSdk>>;

const CLAUDE_SDK_COMMAND = 'claude-sdk';
const DEFAULT_MAX_TURNS = 200;
const DEFAULT_EFFORT = 'medium' as const;
const TURN_TIMEOUT_MS = 3_600_000;

let _sdkCache: LoadedClaudeSdk | undefined;
let _sdkLoadError: unknown;

/** @internal Test-only reset for module-level SDK load cache. */
export function resetClaudeSdkModuleCacheForTests(): void {
  _sdkCache = undefined;
  _sdkLoadError = undefined;
}

async function loadSdk(): Promise<LoadedClaudeSdk> {
  if (_sdkCache) return _sdkCache;
  if (_sdkLoadError) throw _sdkLoadError;
  try {
    _sdkCache = await importBundledClaudeSdk();
    return _sdkCache;
  } catch (err) {
    _sdkLoadError = err;
    throw err;
  }
}

export type ClaudeSdkAgentServiceDeps = CLIAgentServiceDeps;

let cachedSdkPackageVersion: string | undefined;

function getSdkPackageVersion(): string {
  if (cachedSdkPackageVersion) return cachedSdkPackageVersion;
  cachedSdkPackageVersion = getBundledClaudeSdkVersion();
  return cachedSdkPackageVersion;
}

interface SdkSession {
  keeper: ChildProcess;
  aborted: boolean;
  activeQuery?: Query;
  sessionId?: string;
  resumeOnFirstQuery?: boolean;
  storedSystemPrompt?: string;
  resumeResolve?: (prompt: string) => void;
  abortResolve?: () => void;
  pendingResumePrompt?: string;
}

function waitForResumeOrAbort(session: SdkSession): Promise<string | null> {
  if (session.aborted) return Promise.resolve(null);

  const queued = session.pendingResumePrompt;
  if (queued !== undefined) {
    session.pendingResumePrompt = undefined;
    return Promise.resolve(queued);
  }

  return Promise.race([
    new Promise<string>((resolve) => {
      session.resumeResolve = (prompt) => {
        session.resumeResolve = undefined;
        session.abortResolve = undefined;
        resolve(prompt);
      };
    }),
    new Promise<null>((resolve) => {
      session.abortResolve = () => {
        session.resumeResolve = undefined;
        session.abortResolve = undefined;
        resolve(null);
      };
    }),
  ]);
}

function writeSpawnError(
  logPrefix: string,
  err: unknown,
  emitLogLine?: (line: string) => void
): void {
  const line = formatAgentLogLine(logPrefix, 'spawn-error', formatClaudeSdkLoadError(err));
  process.stderr.write(`${line}\n`);
  emitLogLine?.(line);
  console.error(`[${new Date().toISOString()}] ${logPrefix} spawn-error]`, err);
}

// fallow-ignore-next-line complexity
function notifyResumableSessionId(
  message: SDKMessage,
  session: SdkSession,
  correlationId: string,
  callbacks: ((info: HarnessSessionIdUpdatedInfo) => void)[]
): void {
  if (!('session_id' in message) || typeof message.session_id !== 'string') {
    return;
  }
  const resumableId = message.session_id;
  const previousResumableId = session.sessionId;
  if (previousResumableId === resumableId) {
    return;
  }
  session.sessionId = resumableId;
  const info: HarnessSessionIdUpdatedInfo = {
    correlationId,
    resumableId,
    source: previousResumableId ? 'provider_rotated' : 'provider_allocated',
    ...(previousResumableId ? { previousResumableId } : {}),
  };
  for (const cb of callbacks) {
    cb(info);
  }
}

export class ClaudeSdkAgentService extends BaseCLIAgentService {
  readonly id = 'claude-sdk';
  readonly displayName = 'Claude (SDK)';
  readonly command = CLAUDE_SDK_COMMAND;

  private readonly sessions = new Map<number, SdkSession>();

  constructor(deps?: Partial<ClaudeSdkAgentServiceDeps>) {
    super(deps);
  }

  async isInstalled(): Promise<boolean> {
    try {
      await loadSdk();
      await resolvePathToClaudeCodeExecutable();
      return true;
    } catch (err) {
      console.warn(`[claude-sdk] unavailable: ${formatClaudeSdkLoadError(err)}`);
      return false;
    }
  }

  public override detectInstallationEffect(): Effect.Effect<DetectionResult, never> {
    return Effect.promise(async () => {
      const installed = await this.isInstalled();
      return installed ? DetectionResult.Installed() : DetectionResult.NotInstalled();
    });
  }

  async getVersion(): Promise<VersionInfo | null> {
    const match = getSdkPackageVersion().match(/^(\d+)\.(\d+)\.(\d+)/);
    if (!match) return null;
    return {
      version: `${match[1]}.${match[2]}.${match[3]}`,
      major: parseInt(match[1], 10),
    };
  }

  async listModels(): Promise<string[]> {
    const dynamic = await fetchClaudeModels();
    if (dynamic) return dynamic;
    return [...CLAUDE_FALLBACK_MODELS];
  }

  async resumeTurn(pid: number, prompt: string): Promise<void> {
    const session = this.sessions.get(pid);
    if (!session) {
      throw new Error(`No claude-sdk session for pid=${pid}`);
    }
    if (session.resumeResolve) {
      const resolve = session.resumeResolve;
      session.resumeResolve = undefined;
      session.abortResolve = undefined;
      resolve(prompt);
      return;
    }
    session.pendingResumePrompt = prompt;
  }

  // fallow-ignore-next-line complexity
  override async stop(pid: number, _options?: AgentStopOptions): Promise<void> {
    const session = this.sessions.get(pid);
    if (session) {
      session.aborted = true;
      session.abortResolve?.();
      try {
        await withTimeout(
          session.activeQuery
            ? session.activeQuery.interrupt().then(() => undefined)
            : Promise.resolve(undefined),
          5_000,
          'interrupt'
        );
      } catch (err) {
        console.warn(
          `[claude-sdk] interrupt for pid=${pid} failed:`,
          err instanceof Error ? err.message : err
        );
      }
      try {
        session.keeper.kill();
      } catch {
        // May already be dead
      }
      this.sessions.delete(pid);
    }
    await super.stop(pid);
  }

  private spawnKeeper(workingDir: string): ChildProcess {
    const keeper = this.deps.spawn(process.execPath, ['-e', 'setInterval(()=>{},2147483647)'], {
      cwd: workingDir,
      stdio: 'ignore',
      shell: false,
      detached: true,
    });

    if (!keeper.pid) {
      keeper.kill();
      throw new Error('Failed to spawn claude-sdk keeper process');
    }

    return keeper;
  }

  private startRunningSession(args: {
    pid: number;
    keeper: ChildProcess;
    context: SpawnContext;
    workingDir: string;
    model?: string;
    initialPrompt: string;
    deferInitialTurn?: boolean;
    storedSystemPrompt?: string;
    executablePath: string;
    resumedProviderSessionId?: string;
  }): SpawnResult {
    const {
      pid,
      keeper,
      context,
      workingDir,
      model,
      initialPrompt,
      deferInitialTurn = false,
      storedSystemPrompt,
      executablePath,
      resumedProviderSessionId,
    } = args;

    const entry = this.registerProcess(pid, context);
    const logPrefix = buildAgentLogPrefix('claude-sdk', context);

    const sdkSession: SdkSession = {
      keeper,
      aborted: false,
      storedSystemPrompt,
      ...(resumedProviderSessionId
        ? { sessionId: resumedProviderSessionId, resumeOnFirstQuery: true }
        : {}),
    };
    this.sessions.set(pid, sdkSession);

    const exitCallbacks: ((info: {
      code: number | null;
      signal: string | null;
      context: SpawnContext;
    }) => void)[] = [];
    const outputCallbacks: (() => void)[] = [];
    const agentEndCallbacks: (() => void)[] = [];
    const logLineCallbacks: ((line: string) => void)[] = [];
    const assistantTextCallbacks: ((text: string) => void)[] = [];
    const sessionIdUpdatedCallbacks: ((info: HarnessSessionIdUpdatedInfo) => void)[] = [];
    const emitLogLine = (line: string) => {
      for (const cb of logLineCallbacks) cb(line);
    };
    /**
     * Claude's SDK only reveals a real session ID as a side effect of the first
     * turn's stream — but native harnesses defer that first turn. Synthesize a
     * stable per-spawn correlation UUID for delivery gating; provider session IDs
     * are reported separately via onHarnessSessionIdUpdated for daemon-memory resume.
     */
    const harnessSessionId = randomUUID();

    const finishExit = (code: number | null, signal: string | null) => {
      sdkSession.activeQuery = undefined;
      this.sessions.delete(pid);
      this.deleteProcess(pid);
      for (const cb of exitCallbacks) {
        cb({ code, signal, context });
      }
    };

    this.runTurnLoop({
      sdkSession,
      correlationId: harnessSessionId,
      sessionIdUpdatedCallbacks,
      entry,
      logPrefix,
      workingDir,
      model,
      executablePath,
      initialPrompt,
      deferInitialTurn,
      finishExit,
      outputCallbacks,
      agentEndCallbacks,
      assistantTextCallbacks,
      emitLogLine,
    });

    return {
      pid,
      harnessSessionId,
      onExit: (cb) => {
        exitCallbacks.push(cb);
      },
      onOutput: (cb) => {
        outputCallbacks.push(cb);
      },
      onAgentEnd: (cb) => {
        agentEndCallbacks.push(cb);
      },
      onLogLine: (cb) => {
        logLineCallbacks.push(cb);
      },
      onAssistantText: (cb) => {
        assistantTextCallbacks.push(cb);
      },
      onHarnessSessionIdUpdated: (cb) => {
        sessionIdUpdatedCallbacks.push(cb);
        if (resumedProviderSessionId) {
          cb({
            correlationId: harnessSessionId,
            resumableId: resumedProviderSessionId,
            source: 'provider_allocated',
          });
        }
      },
    };
  }

  // fallow-ignore-next-line complexity
  private runTurnLoop(args: {
    sdkSession: SdkSession;
    correlationId: string;
    sessionIdUpdatedCallbacks: ((info: HarnessSessionIdUpdatedInfo) => void)[];
    entry: { lastOutputAt: number };
    logPrefix: string;
    workingDir: string;
    model?: string;
    executablePath: string;
    initialPrompt: string;
    deferInitialTurn?: boolean;
    finishExit: (code: number | null, signal: string | null) => void;
    outputCallbacks: (() => void)[];
    agentEndCallbacks: (() => void)[];
    assistantTextCallbacks: ((text: string) => void)[];
    emitLogLine: (line: string) => void;
  }): void {
    const {
      sdkSession,
      correlationId,
      sessionIdUpdatedCallbacks,
      logPrefix,
      workingDir,
      model,
      executablePath,
      initialPrompt,
      deferInitialTurn = false,
      finishExit,
      entry,
      outputCallbacks,
      agentEndCallbacks,
      assistantTextCallbacks,
      emitLogLine,
    } = args;

    let exited = false;

    void this.executeTurnLoop({
      sdkSession,
      correlationId,
      sessionIdUpdatedCallbacks,
      logPrefix,
      workingDir,
      model,
      executablePath,
      initialPrompt,
      deferInitialTurn,
      finishExit,
      entry,
      outputCallbacks,
      agentEndCallbacks,
      assistantTextCallbacks,
      emitLogLine,
      isExited: () => exited,
      markExited: () => {
        exited = true;
      },
    }).catch((err) => {
      writeSpawnError(logPrefix, err, emitLogLine);
      if (exited) return;
      exited = true;
      try {
        sdkSession.keeper.kill();
      } catch {
        // May already be dead
      }
      finishExit(1, null);
    });
  }

  // fallow-ignore-next-line complexity
  private async executeTurnLoop(args: {
    sdkSession: SdkSession;
    correlationId: string;
    sessionIdUpdatedCallbacks: ((info: HarnessSessionIdUpdatedInfo) => void)[];
    logPrefix: string;
    workingDir: string;
    model?: string;
    executablePath: string;
    initialPrompt: string;
    deferInitialTurn: boolean;
    finishExit: (code: number | null, signal: string | null) => void;
    entry: { lastOutputAt: number };
    outputCallbacks: (() => void)[];
    agentEndCallbacks: (() => void)[];
    assistantTextCallbacks: ((text: string) => void)[];
    emitLogLine: (line: string) => void;
    isExited: () => boolean;
    markExited: () => void;
  }): Promise<void> {
    const {
      sdkSession,
      correlationId,
      sessionIdUpdatedCallbacks,
      logPrefix,
      workingDir,
      model,
      executablePath,
      initialPrompt,
      deferInitialTurn,
      finishExit,
      entry,
      outputCallbacks,
      agentEndCallbacks,
      assistantTextCallbacks,
      emitLogLine,
      isExited,
      markExited,
    } = args;

    let exitCode: number | null = 0;
    let exitSignal: string | null = null;
    let nextPrompt: string | null = deferInitialTurn ? null : initialPrompt;
    let isFirstQuery = true;

    try {
      const { query } = await loadSdk();

      while (!sdkSession.aborted) {
        try {
          if (nextPrompt === null) {
            const deferredResume = await waitForResumeOrAbort(sdkSession);
            if (deferredResume === null || sdkSession.aborted) {
              if (sdkSession.aborted) {
                exitCode = 1;
                exitSignal = 'SIGTERM';
              }
              break;
            }
            nextPrompt = deferredResume;
          }

          const adapter = new ClaudeSdkStreamAdapter(logPrefix, emitLogLine);
          wireNativeStreamAdapter({
            adapter,
            assistantTextCallbacks,
            outputCallbacks,
            agentEndCallbacks,
            entry,
          });

          const useResume =
            Boolean(sdkSession.sessionId) &&
            (!isFirstQuery || sdkSession.resumeOnFirstQuery === true);

          const queryInstance = query({
            prompt: nextPrompt,
            options: {
              cwd: workingDir,
              model,
              maxTurns: DEFAULT_MAX_TURNS,
              pathToClaudeCodeExecutable: executablePath,
              includePartialMessages: true,
              systemPrompt:
                isFirstQuery && !sdkSession.resumeOnFirstQuery
                  ? sdkSession.storedSystemPrompt
                  : undefined,
              resume: useResume ? sdkSession.sessionId : undefined,
              settingSources: [],
              permissionMode: 'bypassPermissions',
              allowDangerouslySkipPermissions: true,
              effort: DEFAULT_EFFORT,
              canUseTool: async (_toolName, input) => ({ behavior: 'allow', updatedInput: input }),
            },
          });
          sdkSession.activeQuery = queryInstance;
          if (sdkSession.resumeOnFirstQuery) {
            sdkSession.resumeOnFirstQuery = false;
          }
          isFirstQuery = false;
          nextPrompt = null;

          await withTimeout(
            (async () => {
              for await (const message of queryInstance) {
                if (sdkSession.aborted) break;
                notifyResumableSessionId(
                  message,
                  sdkSession,
                  correlationId,
                  sessionIdUpdatedCallbacks
                );
                adapter.handleMessage(message);
                if (message.type === 'result') break;
              }
            })(),
            TURN_TIMEOUT_MS,
            'query'
          );

          sdkSession.activeQuery = undefined;

          if (sdkSession.aborted) {
            exitCode = 1;
            exitSignal = 'SIGTERM';
            break;
          }

          adapter.finish();
        } catch (turnErr) {
          exitCode = 1;
          writeSpawnError(logPrefix, turnErr, emitLogLine);
          break;
        }
      }
    } catch (err) {
      exitCode = 1;
      writeSpawnError(logPrefix, err, emitLogLine);
    } finally {
      if (isExited()) return;
      markExited();

      try {
        sdkSession.keeper.kill();
      } catch {
        // May already be dead
      }

      finishExit(exitCode, exitSignal);
    }
  }

  async spawn(options: SpawnOptions): Promise<SpawnResult> {
    const deferInitialTurn = options.deferInitialTurn ?? false;
    const keeper = this.spawnKeeper(options.workingDir);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- spawnKeeper validates pid
    const pid = keeper.pid!;
    const context = options.context;
    const fullPrompt = deferInitialTurn ? '' : options.prompt;

    let executablePath: string;
    try {
      await loadSdk();
      executablePath = await resolvePathToClaudeCodeExecutable();
    } catch (err) {
      keeper.kill();
      this.deleteProcess(pid);
      throw err;
    }

    return this.startRunningSession({
      pid,
      keeper,
      context,
      workingDir: options.workingDir,
      model: options.model,
      initialPrompt: fullPrompt,
      deferInitialTurn,
      storedSystemPrompt: options.systemPrompt,
      executablePath,
    });
  }

  async resumeFromDaemonMemory(
    options: SpawnOptions,
    stored: DaemonHarnessSessionContext
  ): Promise<SpawnResult> {
    try {
      const keeper = this.spawnKeeper(stored.workingDir);
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- spawnKeeper validates pid
      const pid = keeper.pid!;
      await loadSdk();
      const executablePath = await resolvePathToClaudeCodeExecutable();

      return this.startRunningSession({
        pid,
        keeper,
        context: options.context,
        workingDir: stored.workingDir,
        model: options.model ?? stored.model,
        initialPrompt: options.prompt,
        deferInitialTurn: false,
        storedSystemPrompt: options.systemPrompt,
        executablePath,
        resumedProviderSessionId: stored.harnessSessionId,
      });
    } catch (err) {
      writeSpawnError(buildAgentLogPrefix('claude-sdk', options.context), err, (line) =>
        process.stderr.write(`${line}\n`)
      );
      return this.spawn(options);
    }
  }
}
