/**
 * CodexSdkAgentService — concrete RemoteAgentService using @openai/codex-sdk.
 *
 * @see ../HARNESS_GUIDE.md — end-to-end guide for implementing a new harness
 *
 * Spawns an in-process local Codex agent via Codex.startThread +
 * thread.runStreamed, streams ThreadEvent events through CodexSdkStreamAdapter,
 * and uses a lightweight keeper child process so PID-based lifecycle management
 * in the daemon continues to work.
 *
 * AUTH: Codex authenticates with the user's local ChatGPT/Codex subscription via
 * the Codex CLI login/session. `new Codex()` inherits the local process
 * environment, so no OPENAI_API_KEY/CODEX_API_KEY is required or stored in
 * Chatroom configuration. Prerequisite: run the supported local Codex login
 * flow before selecting this harness. Runtime auth failures surface as harness
 * spawn errors.
 *
 * NOTE: @openai/codex-sdk is ESM-only and bundles its Codex CLI runtime via
 * `@openai/codex`. SDK import is deferred via loadSdk() so load failures hide
 * the harness instead of crashing the daemon.
 */

import type { ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import type { Codex, Thread, ThreadOptions } from '@openai/codex-sdk';
import { CODEX_MODEL_VARIANT_COMBINATIONS } from '@workspace/backend/src/domain/entities/harness/codex-sdk.model-variants.js';
import {
  decodeModelVariant,
  validateModelVariantParams,
  type ValidatedModelVariant,
} from '@workspace/backend/src/domain/entities/harness/model-variant.js';
import { stripProviderPrefix } from '@workspace/backend/src/domain/entities/harness/model-provider.js';
import { Effect } from 'effect';

import {
  formatCodexSdkError,
  formatCodexSdkLoadError,
  getBundledCodexSdkVersion,
  importBundledCodexSdk,
  resolveCodexExecutablePath,
} from './codex-sdk-package.js';
import { CodexSdkStreamAdapter } from './codex-sdk-stream-adapter.js';
import { buildAgentSpawnEnv } from '../../../../../../infrastructure/convex/spawn-env.js';
import { buildAgentLogPrefix, formatAgentLogLine } from '../agent-log-format.js';
import { BaseCLIAgentService, type CLIAgentServiceDeps } from '../base-cli-agent-service.js';
import { DetectionResult } from '../detection-result.js';
import type {
  AgentStopOptions,
  DaemonHarnessSessionContext,
  HarnessReconnectMetadata,
  HarnessSessionIdUpdatedInfo,
  SpawnContext,
  SpawnOptions,
  SpawnResult,
  VersionInfo,
} from '../remote-agent-service.js';
import { wireNativeStreamAdapter } from '../wire-native-stream-adapter.js';
import { withTimeout } from '../with-timeout.js';

type LoadedCodexSdk = Awaited<ReturnType<typeof importBundledCodexSdk>>;

const CODEX_SDK_COMMAND = 'codex';
const TURN_TIMEOUT_MS = 3_600_000;

let _sdkCache: LoadedCodexSdk | undefined;
let _sdkLoadError: unknown;

/** @internal Test-only reset for module-level SDK load cache. */
export function resetCodexSdkModuleCacheForTests(): void {
  _sdkCache = undefined;
  _sdkLoadError = undefined;
}

async function loadSdk(): Promise<LoadedCodexSdk> {
  if (_sdkCache) return _sdkCache;
  if (_sdkLoadError) throw _sdkLoadError;
  try {
    _sdkCache = await importBundledCodexSdk();
    return _sdkCache;
  } catch (err) {
    _sdkLoadError = err;
    throw err;
  }
}

export type CodexSdkAgentServiceDeps = CLIAgentServiceDeps;

let cachedSdkPackageVersion: string | undefined;

function getSdkPackageVersion(): string {
  if (cachedSdkPackageVersion) return cachedSdkPackageVersion;
  cachedSdkPackageVersion = getBundledCodexSdkVersion();
  return cachedSdkPackageVersion;
}

interface SdkSession {
  keeper: ChildProcess;
  codex: Codex;
  thread: Thread;
  aborted: boolean;
  threadId?: string;
  model?: string;
  agentName: string;
  /** System prompt prepended to the first injected turn when deferInitialTurn is set. */
  storedSystemPrompt?: string;
  abortController?: AbortController;
  resumeResolve?: (prompt: string) => void;
  abortResolve?: () => void;
  pendingResumePrompt?: string;
}

function buildAgentName(context: SpawnContext): string {
  return `${context.role}@${context.chatroomId.slice(-6)}`;
}

/** A codex variant validated against the codex schema (literal param types). */
type CodexModelVariant = ValidatedModelVariant<typeof CODEX_MODEL_VARIANT_COMBINATIONS>;

/**
 * Strict decode + schema validation of a codex model variant string.
 *
 * Throws ModelVariantParseError / ModelVariantValidationError on any
 * malformed or unknown input — spawn refuses to start rather than silently
 * misconfiguring the model. Grammar + vocabulary live in the shared domain
 * (`model-variant.ts`); the catalog (server-side) is validated by the same
 * code, so any failure here is a genuine mismatch.
 */
function decodeCodexVariant(encoded: string | undefined): CodexModelVariant | undefined {
  if (encoded === undefined) return undefined;
  return validateModelVariantParams(
    decodeModelVariant(stripProviderPrefix('openai', encoded)),
    CODEX_MODEL_VARIANT_COMBINATIONS
  );
}

function buildThreadOptions(workingDir: string, variant?: CodexModelVariant): ThreadOptions {
  const options: ThreadOptions = {
    workingDirectory: workingDir,
    skipGitRepoCheck: true,
    // The agent must be able to reach the Convex deployment from shell tools.
    sandboxMode: 'danger-full-access',
    // Chatroom agents must be able to call the Chatroom CLI, which reaches the
    // Convex deployment over the network.
    networkAccessEnabled: true,
  };
  if (!variant) return options;

  options.model = variant.model;
  const reasoning = variant.params.reasoning;
  if (reasoning !== undefined && reasoning !== 'none') {
    // The Codex SDK names this option "modelReasoningEffort"; our vocabulary
    // is the neutral reasoning level (see model-variant.ts — thinking and
    // effort mean different things across harnesses). "none" leaves the
    // SDK default untouched.
    options.modelReasoningEffort = reasoning;
  }
  return options;
}

function buildCodexEnv(resolvedConvexUrl: string): Record<string, string> {
  return Object.fromEntries(
    Object.entries(buildAgentSpawnEnv(resolvedConvexUrl)).filter(
      (entry): entry is [string, string] => entry[1] !== undefined
    )
  );
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
  const line = formatAgentLogLine(logPrefix, 'spawn-error', formatCodexSdkError(err));
  if (emitLogLine) emitLogLine(line);
  else console.error(`[${new Date().toISOString()}] ${logPrefix} spawn-error]`, err);
}

// fallow-ignore-next-line complexity
function notifyResumableThreadId(
  threadId: string,
  session: SdkSession,
  correlationId: string,
  callbacks: ((info: HarnessSessionIdUpdatedInfo) => void)[]
): void {
  if (session.threadId === threadId) {
    return;
  }
  session.threadId = threadId;
  const info: HarnessSessionIdUpdatedInfo = {
    correlationId,
    resumableId: threadId,
    source: 'provider_allocated',
  };
  for (const cb of callbacks) {
    cb(info);
  }
}

export class CodexSdkAgentService extends BaseCLIAgentService {
  readonly id = 'codex-sdk';
  // Interface-required members consumed by the daemon/registry via RemoteAgentService.
  // fallow-ignore-next-line unused-class-member
  readonly displayName = 'Codex (SDK)';
  readonly command = CODEX_SDK_COMMAND;

  private readonly sessions = new Map<number, SdkSession>();

  constructor(deps?: Partial<CodexSdkAgentServiceDeps>) {
    super(deps);
  }

  async isInstalled(): Promise<boolean> {
    try {
      await loadSdk();
      resolveCodexExecutablePath();
      return true;
    } catch (err) {
      console.warn(`[codex-sdk] unavailable: ${formatCodexSdkLoadError(err)}`);
      return false;
    }
  }

  /**
   * Override the base-class CLI binary detection (which checks for a `codex`
   * binary in PATH — the SDK bundles its own CLI). Gate on a successful SDK
   * load instead, matching isInstalled() behaviour.
   */
  // fallow-ignore-next-line unused-class-member
  public override detectInstallationEffect(): Effect.Effect<DetectionResult, never> {
    return Effect.promise(async () => {
      const installed = await this.isInstalled();
      return installed ? DetectionResult.Installed() : DetectionResult.NotInstalled();
    });
  }

  // fallow-ignore-next-line unused-class-member
  async getVersion(): Promise<VersionInfo | null> {
    const match = getSdkPackageVersion().match(/^(\d+)\.(\d+)\.(\d+)/);
    if (!match) return null;
    return {
      version: `${match[1]}.${match[2]}.${match[3]}`,
      major: parseInt(match[1], 10),
    };
  }

  async listModels(): Promise<string[]> {
    // The Codex SDK exposes no model enumeration API. Return an honest empty
    // list so the UI shows no model picker; Codex uses its configured default.
    return [];
  }

  async resumeTurn(pid: number, prompt: string): Promise<void> {
    const session = this.sessions.get(pid);
    if (!session) {
      throw new Error(`No codex-sdk session for pid=${pid}`);
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
        session.abortController?.abort();
      } catch {
        // Best-effort turn cancellation
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

  getHarnessReconnectContext(pid: number): HarnessReconnectMetadata | undefined {
    const session = this.sessions.get(pid);
    if (!session) {
      return undefined;
    }
    return {
      agentName: session.agentName,
      ...(session.model ? { model: session.model } : {}),
    };
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
      throw new Error('Failed to spawn codex-sdk keeper process');
    }

    return keeper;
  }

  private startRunningSession(args: {
    pid: number;
    keeper: ChildProcess;
    codex: Codex;
    thread: Thread;
    context: SpawnContext;
    workingDir: string;
    model?: string;
    initialPrompt: string;
    deferInitialTurn?: boolean;
    storedSystemPrompt?: string;
    resumedThreadId?: string;
  }): SpawnResult {
    const {
      pid,
      keeper,
      codex,
      thread,
      context,
      model,
      initialPrompt,
      deferInitialTurn = false,
      storedSystemPrompt,
      resumedThreadId,
    } = args;

    const entry = this.registerProcess(pid, context);
    const logPrefix = buildAgentLogPrefix('codex-sdk', context);
    const agentName = buildAgentName(context);
    // The real thread id is only revealed by the first `thread.started` event;
    // synthesize a stable per-spawn correlation UUID for delivery gating and
    // report the thread id via onHarnessSessionIdUpdated for daemon-memory resume.
    const harnessSessionId = randomUUID();

    const session: SdkSession = {
      keeper,
      codex,
      thread,
      aborted: false,
      agentName,
      model,
      storedSystemPrompt,
      ...(resumedThreadId ? { threadId: resumedThreadId } : {}),
    };
    this.sessions.set(pid, session);

    const callbacks = this.buildSessionCallbacks(pid, context);

    this.runTurnLoop({
      session,
      correlationId: harnessSessionId,
      sessionIdUpdatedCallbacks: callbacks.sessionIdUpdatedCallbacks,
      entry,
      logPrefix,
      initialPrompt,
      deferInitialTurn,
      finishExit: callbacks.finishExit,
      outputCallbacks: callbacks.outputCallbacks,
      agentEndCallbacks: callbacks.agentEndCallbacks,
      assistantTextCallbacks: callbacks.assistantTextCallbacks,
      emitLogLine: callbacks.emitLogLine,
    });

    return this.buildSpawnResult({
      pid,
      harnessSessionId,
      resumedThreadId,
      exitCallbacks: callbacks.exitCallbacks,
      outputCallbacks: callbacks.outputCallbacks,
      agentEndCallbacks: callbacks.agentEndCallbacks,
      logLineCallbacks: callbacks.logLineCallbacks,
      assistantTextCallbacks: callbacks.assistantTextCallbacks,
      sessionIdUpdatedCallbacks: callbacks.sessionIdUpdatedCallbacks,
    });
  }

  private buildSessionCallbacks(
    pid: number,
    context: SpawnContext
  ): {
    exitCallbacks: ((info: {
      code: number | null;
      signal: string | null;
      context: SpawnContext;
    }) => void)[];
    outputCallbacks: (() => void)[];
    agentEndCallbacks: (() => void)[];
    logLineCallbacks: ((line: string) => void)[];
    assistantTextCallbacks: ((text: string) => void)[];
    sessionIdUpdatedCallbacks: ((info: HarnessSessionIdUpdatedInfo) => void)[];
    emitLogLine: (line: string) => void;
    finishExit: (code: number | null, signal: string | null) => void;
  } {
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

    const finishExit = (code: number | null, signal: string | null) => {
      this.sessions.delete(pid);
      this.deleteProcess(pid);
      for (const cb of exitCallbacks) {
        cb({ code, signal, context });
      }
    };

    return {
      exitCallbacks,
      outputCallbacks,
      agentEndCallbacks,
      logLineCallbacks,
      assistantTextCallbacks,
      sessionIdUpdatedCallbacks,
      emitLogLine,
      finishExit,
    };
  }

  private buildSpawnResult(args: {
    pid: number;
    harnessSessionId: string;
    resumedThreadId?: string;
    exitCallbacks: ((info: {
      code: number | null;
      signal: string | null;
      context: SpawnContext;
    }) => void)[];
    outputCallbacks: (() => void)[];
    agentEndCallbacks: (() => void)[];
    logLineCallbacks: ((line: string) => void)[];
    assistantTextCallbacks: ((text: string) => void)[];
    sessionIdUpdatedCallbacks: ((info: HarnessSessionIdUpdatedInfo) => void)[];
  }): SpawnResult {
    const {
      pid,
      harnessSessionId,
      resumedThreadId,
      exitCallbacks,
      outputCallbacks,
      agentEndCallbacks,
      logLineCallbacks,
      assistantTextCallbacks,
      sessionIdUpdatedCallbacks,
    } = args;

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
        if (resumedThreadId) {
          cb({
            correlationId: harnessSessionId,
            resumableId: resumedThreadId,
            source: 'provider_allocated',
          });
        }
      },
    };
  }

  // fallow-ignore-next-line complexity
  private runTurnLoop(args: {
    session: SdkSession;
    correlationId: string;
    sessionIdUpdatedCallbacks: ((info: HarnessSessionIdUpdatedInfo) => void)[];
    entry: { lastOutputAt: number };
    logPrefix: string;
    initialPrompt: string;
    deferInitialTurn?: boolean;
    finishExit: (code: number | null, signal: string | null) => void;
    outputCallbacks: (() => void)[];
    agentEndCallbacks: (() => void)[];
    assistantTextCallbacks: ((text: string) => void)[];
    emitLogLine: (line: string) => void;
  }): void {
    const {
      session,
      correlationId,
      sessionIdUpdatedCallbacks,
      logPrefix,
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

    // fallow-ignore-next-line complexity
    void (async () => {
      let exitCode: number | null = 0;
      let exitSignal: string | null = null;
      let nextPrompt: string | null = deferInitialTurn ? null : initialPrompt;
      let prependSystemOnNextResume = deferInitialTurn;
      const storedSystemPrompt = session.storedSystemPrompt;

      try {
        while (!session.aborted) {
          if (nextPrompt === null) {
            const deferredResume = await waitForResumeOrAbort(session);
            if (deferredResume === null || session.aborted) {
              if (session.aborted) {
                exitCode = 1;
                exitSignal = 'SIGTERM';
              }
              break;
            }
            nextPrompt =
              prependSystemOnNextResume && storedSystemPrompt
                ? `${storedSystemPrompt}\n\n${deferredResume}`
                : deferredResume;
            prependSystemOnNextResume = false;
          }

          try {
            await this.runOneTurn({
              session,
              prompt: nextPrompt,
              correlationId,
              sessionIdUpdatedCallbacks,
              entry,
              logPrefix,
              outputCallbacks,
              agentEndCallbacks,
              assistantTextCallbacks,
              emitLogLine,
            });
            nextPrompt = null;
          } catch (turnErr) {
            exitCode = 1;
            writeSpawnError(logPrefix, turnErr, emitLogLine);
            break;
          }

          if (session.aborted) {
            exitCode = 1;
            exitSignal = 'SIGTERM';
            break;
          }
        }
      } catch (err) {
        exitCode = 1;
        writeSpawnError(logPrefix, err, emitLogLine);
      } finally {
        if (exited) return;
        exited = true;

        try {
          session.keeper.kill();
        } catch {
          // May already be dead
        }

        finishExit(exitCode, exitSignal);
      }
    })().catch((err) => {
      writeSpawnError(logPrefix, err, emitLogLine);
      if (exited) return;
      exited = true;
      try {
        session.keeper.kill();
      } catch {
        // May already be dead
      }
      finishExit(1, null);
    });
  }

  private async runOneTurn(args: {
    session: SdkSession;
    prompt: string;
    correlationId: string;
    sessionIdUpdatedCallbacks: ((info: HarnessSessionIdUpdatedInfo) => void)[];
    entry: { lastOutputAt: number };
    logPrefix: string;
    outputCallbacks: (() => void)[];
    agentEndCallbacks: (() => void)[];
    assistantTextCallbacks: ((text: string) => void)[];
    emitLogLine: (line: string) => void;
  }): Promise<void> {
    const {
      session,
      prompt,
      correlationId,
      sessionIdUpdatedCallbacks,
      entry,
      logPrefix,
      outputCallbacks,
      agentEndCallbacks,
      assistantTextCallbacks,
      emitLogLine,
    } = args;

    const adapter = new CodexSdkStreamAdapter(logPrefix, emitLogLine);
    wireNativeStreamAdapter({
      adapter,
      assistantTextCallbacks,
      outputCallbacks,
      agentEndCallbacks,
      entry,
    });

    const abortController = new AbortController();
    session.abortController = abortController;

    try {
      await withTimeout(
        // fallow-ignore-next-line complexity
        (async () => {
          const { events } = await session.thread.runStreamed(prompt, {
            signal: abortController.signal,
          });
          for await (const event of events) {
            if (session.aborted) break;
            adapter.handleEvent(event);
            if (event.type === 'thread.started') {
              notifyResumableThreadId(
                event.thread_id,
                session,
                correlationId,
                sessionIdUpdatedCallbacks
              );
            }
          }
        })(),
        TURN_TIMEOUT_MS,
        'thread.runStreamed'
      );
    } finally {
      session.abortController = undefined;
    }

    // finish() emits lifecycle.turn.completed (wired to onAgentEnd) once per
    // turn, whether the turn completed or failed, so a later resumeTurn can arm
    // a new onAgentEnd.
    adapter.finish();
  }

  async spawn(options: SpawnOptions): Promise<SpawnResult> {
    const variant = decodeCodexVariant(options.model); // strict — refuses malformed variants before any side effects
    const deferInitialTurn = options.deferInitialTurn ?? false;
    const keeper = this.spawnKeeper(options.workingDir);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- spawnKeeper validates pid
    const pid = keeper.pid!;
    const context = options.context;
    const fullPrompt = deferInitialTurn ? '' : `${options.systemPrompt}\n\n${options.prompt}`;

    let codex: Codex;
    let thread: Thread;
    try {
      const { Codex } = await loadSdk();
      const codexPath = resolveCodexExecutablePath();
      codex = new Codex({
        codexPathOverride: codexPath,
        env: buildCodexEnv(options.resolvedConvexUrl),
      });
      thread = codex.startThread(buildThreadOptions(options.workingDir, variant));
    } catch (err) {
      writeSpawnError(buildAgentLogPrefix('codex-sdk', context), err);
      keeper.kill();
      this.deleteProcess(pid);
      throw err;
    }

    return this.startRunningSession({
      pid,
      keeper,
      codex,
      thread,
      context,
      workingDir: options.workingDir,
      model: options.model,
      initialPrompt: fullPrompt,
      deferInitialTurn,
      storedSystemPrompt: options.systemPrompt,
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

      const variant = decodeCodexVariant(options.model ?? stored.model);
      const { Codex } = await loadSdk();
      const codexPath = resolveCodexExecutablePath();
      const codex = new Codex({
        codexPathOverride: codexPath,
        env: buildCodexEnv(options.resolvedConvexUrl),
      });
      const thread = codex.resumeThread(
        stored.harnessSessionId,
        buildThreadOptions(stored.workingDir, variant)
      );

      return this.startRunningSession({
        pid,
        keeper,
        codex,
        thread,
        context: options.context,
        workingDir: stored.workingDir,
        model: options.model ?? stored.model,
        initialPrompt: options.prompt,
        storedSystemPrompt: options.systemPrompt,
        resumedThreadId: stored.harnessSessionId,
      });
    } catch (err) {
      writeSpawnError(buildAgentLogPrefix('codex-sdk', options.context), err);
      return this.spawn(options);
    }
  }
}
