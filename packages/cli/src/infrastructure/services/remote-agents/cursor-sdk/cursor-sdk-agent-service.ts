/**
 * CursorSdkAgentService — concrete RemoteAgentService using @cursor/sdk.
 *
 * @see ../HARNESS_GUIDE.md — end-to-end guide for implementing a new harness
 *
 * Spawns a local Cursor agent via Agent.create + agent.send, streams SDKMessage
 * events through CursorSdkStreamAdapter, and uses a lightweight keeper child
 * process so PID-based lifecycle management in the daemon continues to work.
 *
 * NOTE: @cursor/sdk depends on sqlite3, a native .node addon. To avoid crashing
 * the daemon on startup when sqlite3 native binaries fail to load (ABI mismatch,
 * wrong Node version, unsupported platform, etc.), the SDK is imported lazily at
 * runtime via loadSdk(). If the import fails, isInstalled() returns false and the
 * harness is hidden from the picker without affecting other harnesses.
 */

import type { ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';

// Type-only import — no runtime effect, safe even if native deps fail to load.
import type * as CursorSdkModule from '@cursor/sdk';
import { Effect } from 'effect';

import { BaseCLIAgentService, type CLIAgentServiceDeps } from '../base-cli-agent-service.js';
import { DetectionResult } from '../detection-result.js';
import type {
  AgentStopOptions,
  DaemonHarnessSessionContext,
  HarnessReconnectMetadata,
  SpawnContext,
  SpawnOptions,
  SpawnResult,
  VersionInfo,
} from '../remote-agent-service.js';
import { normalizeCursorSdkListedModels, resolveCursorSdkModel } from './cursor-models.js';
import {
  formatCursorSdkLoadError,
  getBundledCursorSdkVersion,
  importBundledCursorSdk,
} from './cursor-sdk-package.js';
import { closeCursorAgentOnFailure } from './cursor-sdk-session-cleanup.js';
import { CursorSdkStreamAdapter } from './cursor-sdk-stream-adapter.js';

type Run = CursorSdkModule.Run;
type SDKAgent = CursorSdkModule.SDKAgent;
type LoadedCursorSdk = typeof CursorSdkModule;

// ─── Constants ─────────────────────────────────────────────────────────────────

/**
 * Injected at the top of every system prompt to prevent the Cursor agent from
 * spawning internal subagents. Cursor's backend defaults to fast-routing and
 * may spawn subagents (explore, generalPurpose, etc.) which use a different
 * model and ignore the parent agent's instructions.
 */
const NO_SUBAGENT_DIRECTIVE = 'NEVER spawn subagents. Follow the chatroom instructions strictly.';

// ─── Lazy SDK loader ───────────────────────────────────────────────────────────
// @cursor/sdk loads sqlite3 (a native .node addon) on import. We defer the
// import until first use so that sqlite3 binary failures are caught at call
// sites (isInstalled / spawn / listModels) rather than at daemon startup.

let _sdkCache: LoadedCursorSdk | undefined;
let _sdkLoadError: unknown;

async function loadSdk(): Promise<LoadedCursorSdk> {
  if (_sdkCache) return _sdkCache;
  if (_sdkLoadError) throw _sdkLoadError;
  try {
    // Load @cursor/sdk from this chatroom-cli install only (never a hoisted global copy).
    _sdkCache = await importBundledCursorSdk();
    return _sdkCache;
  } catch (err) {
    _sdkLoadError = err;
    throw err;
  }
}

export type CursorSdkAgentServiceDeps = CLIAgentServiceDeps;

const CURSOR_SDK_COMMAND = 'cursor-sdk';
const DEFAULT_MODEL = 'composer-2.5';
const AGENT_CREATE_TIMEOUT_MS = 60_000;
const SEND_TIMEOUT_MS = 60_000;
const RUN_WAIT_TIMEOUT_MS = 3_600_000;
const MODELS_LIST_TIMEOUT_MS = 10_000;
const RUN_CANCEL_TIMEOUT_MS = 5_000;

let cachedSdkPackageVersion: string | undefined;

function getSdkPackageVersion(): string {
  if (cachedSdkPackageVersion) return cachedSdkPackageVersion;
  cachedSdkPackageVersion = getBundledCursorSdkVersion();
  return cachedSdkPackageVersion;
}

async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

interface SdkSession {
  agent: SDKAgent;
  run?: Run;
  keeper: ChildProcess;
  aborted: boolean;
  agentClosed: boolean;
  preserveForResume: boolean;
  agentName: string;
  model?: string;
  workingDir: string;
  /** Resolves when resumeTurn delivers the next prompt. */
  resumeResolve?: (prompt: string) => void;
  /** Resolves when stop() aborts while waiting for resume. */
  abortResolve?: () => void;
}

function buildAgentName(context: SpawnContext): string {
  return `${context.role}@${context.chatroomId.slice(-6)}`;
}

function waitForResumeOrAbort(session: SdkSession): Promise<string | null> {
  if (session.aborted) return Promise.resolve(null);

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

function buildLogPrefix(context: SpawnOptions['context']): string {
  const roleTag = context.role ?? 'unknown';
  const chatroomSuffix = context.chatroomId ? `@${context.chatroomId.slice(-6)}` : '';
  return `[cursor-sdk:${roleTag}${chatroomSuffix}`;
}

function resolveModelId(model?: string): string {
  return model ? resolveCursorSdkModel(model) : DEFAULT_MODEL;
}

function writeSpawnError(
  logPrefix: string,
  err: unknown,
  emitLogLine?: (line: string) => void
): void {
  const line = `${logPrefix} spawn-error] ${formatCursorSdkLoadError(err)}`;
  process.stderr.write(`${line}\n`);
  emitLogLine?.(line);
  console.error(`[${new Date().toISOString()}] ${logPrefix} spawn-error]`, err);
}

export class CursorSdkAgentService extends BaseCLIAgentService {
  readonly id = 'cursor-sdk';
  readonly displayName = 'Cursor (SDK)';
  readonly command = CURSOR_SDK_COMMAND;

  private readonly sessions = new Map<number, SdkSession>();

  constructor(deps?: Partial<CursorSdkAgentServiceDeps>) {
    super(deps);
  }

  async isInstalled(): Promise<boolean> {
    if (!process.env.CURSOR_API_KEY?.trim()) return false;
    // Verify package integrity and native deps (sqlite3) before exposing the
    // harness. Failures hide the harness rather than crashing the daemon.
    try {
      await loadSdk();
      return true;
    } catch (err) {
      console.warn(`[cursor-sdk] unavailable: ${formatCursorSdkLoadError(err)}`);
      return false;
    }
  }

  /**
   * Override the base-class CLI binary detection (which checks for a `cursor-sdk`
   * binary in PATH — there is none). Instead we gate on CURSOR_API_KEY presence
   * and a successful SDK native-module load, matching isInstalled() behaviour.
   */
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
    const apiKey = process.env.CURSOR_API_KEY?.trim();
    if (!apiKey) return [];

    try {
      const { Cursor } = await loadSdk();
      const models = await withTimeout(
        Cursor.models.list({ apiKey }),
        MODELS_LIST_TIMEOUT_MS,
        'Cursor.models.list'
      );
      const listedModelIds = models.map((m) => m.id).filter((id) => id.length > 0);
      return normalizeCursorSdkListedModels(listedModelIds);
    } catch (err) {
      console.warn(
        `[cursor-sdk] Cursor.models.list failed:`,
        err instanceof Error ? err.message : err
      );
      return [];
    }
  }

  async resumeTurn(pid: number, prompt: string): Promise<void> {
    const session = this.sessions.get(pid);
    if (!session) {
      throw new Error(`No cursor-sdk session for pid=${pid}`);
    }
    if (!session.resumeResolve) {
      throw new Error(`cursor-sdk session pid=${pid} not waiting for resume`);
    }
    const resolve = session.resumeResolve;
    session.resumeResolve = undefined;
    session.abortResolve = undefined;
    resolve(prompt);
  }

  override async stop(pid: number, options?: AgentStopOptions): Promise<void> {
    const session = this.sessions.get(pid);
    if (session) {
      session.aborted = true;
      if (options?.preserveForResume) {
        session.preserveForResume = true;
      }
      session.abortResolve?.();
      const run = session.run;
      if (run?.supports('cancel')) {
        try {
          await withTimeout(run.cancel(), RUN_CANCEL_TIMEOUT_MS, 'run.cancel');
        } catch (err) {
          console.warn(
            `[cursor-sdk] run.cancel for pid=${pid} failed:`,
            err instanceof Error ? err.message : err
          );
        }
      }
      if (!session.preserveForResume && !session.agentClosed) {
        try {
          session.agent.close();
          session.agentClosed = true;
        } catch {
          // Best-effort cleanup
        }
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

  async resumeFromDaemonMemory(
    options: SpawnOptions,
    stored: DaemonHarnessSessionContext
  ): Promise<SpawnResult> {
    const apiKey = process.env.CURSOR_API_KEY?.trim();
    if (!apiKey) {
      throw new Error('CURSOR_API_KEY is not set');
    }

    const keeper = this.spawnKeeper(options.workingDir);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- spawnKeeper validates pid
    const pid = keeper.pid!;
    const context = options.context;
    const agentName = stored.agentName;
    const modelId = resolveModelId(options.model ?? stored.model);
    const systemPrompt = options.systemPrompt
      ? `${NO_SUBAGENT_DIRECTIVE}\n\n${options.systemPrompt}`
      : NO_SUBAGENT_DIRECTIVE;
    const fullPrompt = `${systemPrompt}\n\n${options.prompt}`;

    let agent: SDKAgent;
    try {
      const { Agent } = await loadSdk();
      agent = await withTimeout(
        Agent.resume(stored.harnessSessionId, {
          apiKey,
          model: { id: modelId },
          local: { cwd: stored.workingDir, settingSources: [] },
        }),
        AGENT_CREATE_TIMEOUT_MS,
        'Agent.resume'
      );
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      process.stderr.write(
        `[${new Date().toISOString()}] role:${context.role} daemon-resume-fallback] ${reason} — cold spawning\n`
      );
      keeper.kill();
      this.deleteProcess(pid);
      return this.spawn(options);
    }

    return this.startRunningSession({
      pid,
      keeper,
      agent,
      context,
      agentName,
      model: options.model ?? stored.model,
      workingDir: stored.workingDir,
      initialPrompt: fullPrompt,
      forceFirstTurn: true,
    });
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
      throw new Error('Failed to spawn cursor-sdk keeper process');
    }

    return keeper;
  }

  private startRunningSession(args: {
    pid: number;
    keeper: ChildProcess;
    agent: SDKAgent;
    context: SpawnContext;
    agentName: string;
    model?: string;
    workingDir: string;
    initialPrompt: string;
    forceFirstTurn: boolean;
  }): SpawnResult {
    const {
      pid,
      keeper,
      agent,
      context,
      agentName,
      model,
      workingDir,
      initialPrompt,
      forceFirstTurn,
    } = args;

    const entry = this.registerProcess(pid, context);
    const logPrefix = buildLogPrefix(context);

    const session: SdkSession = {
      agent,
      keeper,
      aborted: false,
      agentClosed: false,
      preserveForResume: false,
      agentName,
      model,
      workingDir,
    };
    this.sessions.set(pid, session);

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
      this.sessions.delete(pid);
      this.deleteProcess(pid);
      for (const cb of exitCallbacks) {
        cb({ code, signal, context });
      }
    };

    this.runTurnLoop({
      pid,
      agent,
      session,
      context,
      entry,
      logPrefix,
      initialPrompt,
      forceFirstTurn,
      finishExit,
      outputCallbacks,
      agentEndCallbacks,
      emitLogLine,
    });

    return {
      pid,
      harnessSessionId: agent.agentId,
      harnessReconnect: {
        agentName,
        ...(model ? { model } : {}),
      },
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
    pid: number;
    agent: SDKAgent;
    session: SdkSession;
    context: SpawnContext;
    entry: { lastOutputAt: number };
    logPrefix: string;
    initialPrompt: string;
    forceFirstTurn: boolean;
    finishExit: (code: number | null, signal: string | null) => void;
    outputCallbacks: (() => void)[];
    agentEndCallbacks: (() => void)[];
    emitLogLine: (line: string) => void;
  }): void {
    const {
      agent,
      session,
      logPrefix,
      initialPrompt,
      forceFirstTurn,
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
      let nextPrompt = initialPrompt;
      let isFirstTurn = forceFirstTurn;

      try {
        while (!session.aborted) {
          try {
            const run = await withTimeout(
              agent.send(nextPrompt, {
                local: { force: isFirstTurn },
                idempotencyKey: randomUUID(),
              }),
              SEND_TIMEOUT_MS,
              'agent.send'
            );
            session.run = run;
            isFirstTurn = false;

            const adapter = new CursorSdkStreamAdapter(logPrefix, emitLogLine);
            adapter.onOutput(() => {
              entry.lastOutputAt = Date.now();
              for (const cb of outputCallbacks) cb();
            });
            adapter.onAgentEnd(() => {
              for (const cb of agentEndCallbacks) cb();
            });

            try {
              for await (const message of run.stream()) {
                if (session.aborted) break;
                adapter.handleMessage(message);
              }
            } catch (streamErr) {
              exitCode = 1;
              writeSpawnError(logPrefix, streamErr, emitLogLine);
              break;
            }

            if (session.aborted) {
              exitCode = 1;
              exitSignal = 'SIGTERM';
              break;
            }

            let result;
            try {
              result = await withTimeout(run.wait(), RUN_WAIT_TIMEOUT_MS, 'run.wait');
            } catch (waitErr) {
              exitCode = 1;
              writeSpawnError(logPrefix, waitErr, emitLogLine);
              break;
            }

            adapter.flushPendingOutput();

            if (result.status === 'error') {
              exitCode = 2;
              const runErrorLine = `${logPrefix} run-error] run ${result.id} failed`;
              process.stderr.write(`${runErrorLine}\n`);
              emitLogLine(runErrorLine);
              break;
            }

            // Enter resume wait before finish() emits agent_end. handleAgentEnd
            // calls resumeTurn synchronously from that callback; resumeResolve
            // must already be registered or resumeTurn throws "not waiting for resume".
            const resumePromise = waitForResumeOrAbort(session);

            // finish() emits agent_end (wired to agentEndCallbacks) only after a
            // successful run.wait(), so resumeTurn is not invoked mid-stream.
            adapter.finish();

            const resumePrompt = await resumePromise;
            if (resumePrompt === null || session.aborted) {
              if (session.aborted) {
                exitCode = 1;
                exitSignal = 'SIGTERM';
              }
              break;
            }

            nextPrompt = resumePrompt;
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

        closeCursorAgentOnFailure(agent, session, exitCode);

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
      closeCursorAgentOnFailure(agent, session, 1, true);
      try {
        session.keeper.kill();
      } catch {
        // May already be dead
      }
      finishExit(1, null);
    });
  }

  async spawn(options: SpawnOptions): Promise<SpawnResult> {
    const apiKey = process.env.CURSOR_API_KEY?.trim();
    if (!apiKey) {
      throw new Error('CURSOR_API_KEY is not set');
    }

    const keeper = this.spawnKeeper(options.workingDir);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- spawnKeeper validates pid
    const pid = keeper.pid!;
    const context = options.context;
    const agentName = buildAgentName(context);
    const modelId = resolveModelId(options.model);
    const systemPrompt = options.systemPrompt
      ? `${NO_SUBAGENT_DIRECTIVE}\n\n${options.systemPrompt}`
      : NO_SUBAGENT_DIRECTIVE;
    const fullPrompt = `${systemPrompt}\n\n${options.prompt}`;

    let agent: SDKAgent;
    try {
      const { Agent } = await loadSdk();
      agent = await withTimeout(
        Agent.create({
          apiKey,
          name: agentName,
          model: { id: modelId, params: [{ id: 'fast', value: 'false' }] },
          local: { cwd: options.workingDir, settingSources: [] },
        }),
        AGENT_CREATE_TIMEOUT_MS,
        'Agent.create'
      );
    } catch (err) {
      keeper.kill();
      this.deleteProcess(pid);
      throw err;
    }

    return this.startRunningSession({
      pid,
      keeper,
      agent,
      context,
      agentName,
      model: options.model,
      workingDir: options.workingDir,
      initialPrompt: fullPrompt,
      forceFirstTurn: true,
    });
  }
}
