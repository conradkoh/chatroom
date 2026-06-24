/**
 * PiSdkAgentService — concrete RemoteAgentService using @earendil-works/pi-coding-agent.
 *
 * @see ../HARNESS_GUIDE.md — end-to-end guide for implementing a new harness
 *
 * Spawns an in-process Pi agent via createAgentSession, streams AgentSessionEvent
 * through PiSdkStreamAdapter, and uses a lightweight keeper child process so
 * PID-based lifecycle management in the daemon continues to work.
 *
 * SDK import is deferred via loadSdk() so load failures hide the harness instead of
 * crashing the daemon.
 */

import type { ChildProcess } from 'node:child_process';

import type {
  AgentSession,
  AgentSessionEvent,
  ModelRegistry,
} from '@earendil-works/pi-coding-agent';
import { Effect } from 'effect';

import { buildAgentLogPrefix, formatAgentLogLine } from '../agent-log-format.js';
import { BaseCLIAgentService, type CLIAgentServiceDeps } from '../base-cli-agent-service.js';
import { DetectionResult } from '../detection-result.js';
import { getPiSessionDir } from '../pi/pi-agent-service.js';
import type {
  AgentStopOptions,
  SpawnContext,
  SpawnOptions,
  SpawnResult,
  VersionInfo,
} from '../remote-agent-service.js';
import { withTimeout } from '../with-timeout.js';
import {
  formatPiSdkLoadError,
  getBundledPiSdkVersion,
  importBundledPiSdk,
} from './pi-sdk-package.js';
import { PiSdkStreamAdapter } from './pi-sdk-stream-adapter.js';

type LoadedPiSdk = Awaited<ReturnType<typeof importBundledPiSdk>>;

const PI_SDK_COMMAND = 'pi-sdk';
const SESSION_CREATE_TIMEOUT_MS = 60_000;
const PROMPT_TIMEOUT_MS = 3_600_000;

let _sdkCache: LoadedPiSdk | undefined;
let _sdkLoadError: unknown;

async function loadSdk(): Promise<LoadedPiSdk> {
  if (_sdkCache) return _sdkCache;
  if (_sdkLoadError) throw _sdkLoadError;
  try {
    _sdkCache = await importBundledPiSdk();
    return _sdkCache;
  } catch (err) {
    _sdkLoadError = err;
    throw err;
  }
}

export type PiSdkAgentServiceDeps = CLIAgentServiceDeps;

let cachedSdkPackageVersion: string | undefined;

function getSdkPackageVersion(): string {
  if (cachedSdkPackageVersion) return cachedSdkPackageVersion;
  cachedSdkPackageVersion = getBundledPiSdkVersion();
  return cachedSdkPackageVersion;
}

interface SdkSession {
  session: AgentSession;
  unsubscribe?: () => void;
  keeper: ChildProcess;
  aborted: boolean;
  /** System prompt prepended to the first injected turn when deferInitialTurn is set. */
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

function resolveModel(modelRegistry: ModelRegistry, model?: string) {
  if (model) {
    const slash = model.indexOf('/');
    if (slash === -1) {
      return modelRegistry.getAll().find((entry) => entry.id === model);
    }
    const provider = model.slice(0, slash);
    const modelId = model.slice(slash + 1);
    return modelRegistry.find(provider, modelId);
  }
  return modelRegistry.getAvailable()[0];
}

function writeSpawnError(
  logPrefix: string,
  err: unknown,
  emitLogLine?: (line: string) => void
): void {
  const line = formatAgentLogLine(logPrefix, 'spawn-error', formatPiSdkLoadError(err));
  process.stderr.write(`${line}\n`);
  emitLogLine?.(line);
  console.error(`[${new Date().toISOString()}] ${logPrefix} spawn-error]`, err);
}

export class PiSdkAgentService extends BaseCLIAgentService {
  readonly id = 'pi-sdk';
  readonly displayName = 'Pi (SDK)';
  readonly command = PI_SDK_COMMAND;

  private readonly sessions = new Map<number, SdkSession>();

  constructor(deps?: Partial<PiSdkAgentServiceDeps>) {
    super(deps);
  }

  async isInstalled(): Promise<boolean> {
    try {
      const { ModelRegistry, AuthStorage } = await loadSdk();
      const authStorage = AuthStorage.create();
      const modelRegistry = ModelRegistry.create(authStorage);
      return modelRegistry.getAvailable().length > 0;
    } catch (err) {
      console.warn(`[pi-sdk] unavailable: ${formatPiSdkLoadError(err)}`);
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
    try {
      const { ModelRegistry, AuthStorage } = await loadSdk();
      const authStorage = AuthStorage.create();
      const modelRegistry = ModelRegistry.create(authStorage);
      return modelRegistry.getAvailable().map((entry) => `${entry.provider}/${entry.id}`);
    } catch (err) {
      console.warn(`[pi-sdk] listModels failed:`, err instanceof Error ? err.message : err);
      return [];
    }
  }

  async resumeTurn(pid: number, prompt: string): Promise<void> {
    const session = this.sessions.get(pid);
    if (!session) {
      throw new Error(`No pi-sdk session for pid=${pid}`);
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

  override async stop(pid: number, _options?: AgentStopOptions): Promise<void> {
    const session = this.sessions.get(pid);
    if (session) {
      session.aborted = true;
      session.abortResolve?.();
      session.unsubscribe?.();
      try {
        await withTimeout(session.session.abort(), 5_000, 'session.abort');
      } catch (err) {
        console.warn(
          `[pi-sdk] session.abort for pid=${pid} failed:`,
          err instanceof Error ? err.message : err
        );
      }
      try {
        session.session.dispose();
      } catch {
        // Best-effort cleanup
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
      throw new Error('Failed to spawn pi-sdk keeper process');
    }

    return keeper;
  }

  private async createSession(args: {
    workingDir: string;
    systemPrompt: string;
    model?: string;
  }): Promise<AgentSession> {
    const {
      AuthStorage,
      createAgentSession,
      DefaultResourceLoader,
      getAgentDir,
      ModelRegistry,
      SessionManager,
    } = await loadSdk();

    const authStorage = AuthStorage.create();
    const modelRegistry = ModelRegistry.create(authStorage);
    const resolvedModel = resolveModel(modelRegistry, args.model);
    if (!resolvedModel) {
      throw new Error(
        'No Pi model available — configure provider credentials in ~/.pi/agent/auth.json'
      );
    }

    const agentDir = getAgentDir();
    const resourceLoader = new DefaultResourceLoader({
      cwd: args.workingDir,
      agentDir,
      systemPromptOverride: () => args.systemPrompt,
    });
    await resourceLoader.reload();

    const { session } = await withTimeout(
      createAgentSession({
        cwd: args.workingDir,
        model: resolvedModel,
        sessionManager: SessionManager.create(getPiSessionDir(args.workingDir)),
        authStorage,
        modelRegistry,
        resourceLoader,
      }),
      SESSION_CREATE_TIMEOUT_MS,
      'createAgentSession'
    );

    return session;
  }

  private startRunningSession(args: {
    pid: number;
    keeper: ChildProcess;
    session: AgentSession;
    context: SpawnContext;
    workingDir: string;
    model?: string;
    initialPrompt: string;
    deferInitialTurn?: boolean;
    storedSystemPrompt?: string;
  }): SpawnResult {
    const {
      pid,
      keeper,
      session,
      context,
      initialPrompt,
      deferInitialTurn = false,
      storedSystemPrompt,
    } = args;

    const entry = this.registerProcess(pid, context);
    const logPrefix = buildAgentLogPrefix('pi-sdk', context);

    const sdkSession: SdkSession = {
      session,
      keeper,
      aborted: false,
      storedSystemPrompt,
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
    const emitLogLine = (line: string) => {
      for (const cb of logLineCallbacks) cb(line);
    };

    const finishExit = (code: number | null, signal: string | null) => {
      sdkSession.unsubscribe?.();
      this.sessions.delete(pid);
      this.deleteProcess(pid);
      for (const cb of exitCallbacks) {
        cb({ code, signal, context });
      }
    };

    this.runTurnLoop({
      session: sdkSession,
      entry,
      logPrefix,
      initialPrompt,
      deferInitialTurn,
      finishExit,
      outputCallbacks,
      agentEndCallbacks,
      emitLogLine,
    });

    return {
      pid,
      harnessSessionId: session.sessionId,
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
    };
  }

  private runTurnLoop(args: {
    session: SdkSession;
    entry: { lastOutputAt: number };
    logPrefix: string;
    initialPrompt: string;
    deferInitialTurn?: boolean;
    finishExit: (code: number | null, signal: string | null) => void;
    outputCallbacks: (() => void)[];
    agentEndCallbacks: (() => void)[];
    emitLogLine: (line: string) => void;
  }): void {
    const {
      session: sdkSession,
      logPrefix,
      initialPrompt,
      deferInitialTurn = false,
      finishExit,
      entry,
      outputCallbacks,
      agentEndCallbacks,
      emitLogLine,
    } = args;

    let exited = false;

    void (async () => {
      let exitCode: number | null = 0;
      let exitSignal: string | null = null;
      let nextPrompt: string | null = deferInitialTurn ? null : initialPrompt;
      let prependSystemOnNextResume = deferInitialTurn;
      const storedSystemPrompt = sdkSession.storedSystemPrompt;

      try {
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
              nextPrompt =
                prependSystemOnNextResume && storedSystemPrompt
                  ? `${storedSystemPrompt}\n\n${deferredResume}`
                  : deferredResume;
              prependSystemOnNextResume = false;
            }

            const adapter = new PiSdkStreamAdapter(logPrefix, emitLogLine);
            adapter.onOutput(() => {
              entry.lastOutputAt = Date.now();
              for (const cb of outputCallbacks) cb();
            });
            adapter.onAgentEnd(() => {
              for (const cb of agentEndCallbacks) cb();
            });

            const onSessionEvent = (event: AgentSessionEvent) => {
              if (sdkSession.aborted) return;
              adapter.handleEvent(event);
            };

            sdkSession.unsubscribe?.();
            sdkSession.unsubscribe = sdkSession.session.subscribe(onSessionEvent);

            await withTimeout(
              sdkSession.session.prompt(nextPrompt),
              PROMPT_TIMEOUT_MS,
              'session.prompt'
            );

            if (sdkSession.aborted) {
              exitCode = 1;
              exitSignal = 'SIGTERM';
              break;
            }

            adapter.finish();
            nextPrompt = null;
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
        if (exited) return;
        exited = true;

        sdkSession.unsubscribe?.();
        try {
          sdkSession.session.dispose();
        } catch {
          // Best-effort cleanup
        }
        try {
          sdkSession.keeper.kill();
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
        sdkSession.keeper.kill();
      } catch {
        // May already be dead
      }
      finishExit(1, null);
    });
  }

  async spawn(options: SpawnOptions): Promise<SpawnResult> {
    const deferInitialTurn = options.deferInitialTurn ?? false;
    const keeper = this.spawnKeeper(options.workingDir);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- spawnKeeper validates pid
    const pid = keeper.pid!;
    const context = options.context;
    const fullPrompt = deferInitialTurn ? '' : `${options.systemPrompt}\n\n${options.prompt}`;

    let session: AgentSession;
    try {
      session = await this.createSession({
        workingDir: options.workingDir,
        systemPrompt: options.systemPrompt,
        model: options.model,
      });
    } catch (err) {
      keeper.kill();
      this.deleteProcess(pid);
      throw err;
    }

    return this.startRunningSession({
      pid,
      keeper,
      session,
      context,
      workingDir: options.workingDir,
      model: options.model,
      initialPrompt: fullPrompt,
      deferInitialTurn,
      storedSystemPrompt: options.systemPrompt,
    });
  }
}
