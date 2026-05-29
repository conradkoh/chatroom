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

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import type { ChildProcess } from 'node:child_process';

// Type-only import — no runtime effect, safe even if native deps fail to load.
import type { Run, SDKAgent } from '@cursor/sdk';

// ─── Lazy SDK loader ───────────────────────────────────────────────────────────
// @cursor/sdk loads sqlite3 (a native .node addon) on import. We defer the
// import until first use so that sqlite3 binary failures are caught at call
// sites (isInstalled / spawn / listModels) rather than at daemon startup.

let _sdkCache: typeof import('@cursor/sdk') | undefined;
let _sdkLoadError: unknown;

async function loadSdk(): Promise<typeof import('@cursor/sdk')> {
  if (_sdkCache) return _sdkCache;
  if (_sdkLoadError) throw _sdkLoadError;
  try {
    _sdkCache = await import('@cursor/sdk');
    return _sdkCache;
  } catch (err) {
    _sdkLoadError = err;
    throw err;
  }
}

import { Effect } from 'effect';

import { BaseCLIAgentService, type CLIAgentServiceDeps } from '../base-cli-agent-service.js';
import { DetectionResult } from '../detection-result.js';
import type {
  SpawnContext,
  SpawnOptions,
  SpawnResult,
  VersionInfo,
} from '../remote-agent-service.js';
import { CURSOR_SDK_FALLBACK_MODELS, resolveCursorSdkModel } from './cursor-models.js';
import { CursorSdkStreamAdapter } from './cursor-sdk-stream-adapter.js';

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
  const require = createRequire(import.meta.url);
  const entry = require.resolve('@cursor/sdk');
  const packageJsonPath = join(entry, '..', '..', '..', 'package.json');
  const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { version: string };
  cachedSdkPackageVersion = pkg.version;
  return pkg.version;
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
  /** Resolves when resumeTurn delivers the next prompt. */
  resumeResolve?: (prompt: string) => void;
  /** Resolves when stop() aborts while waiting for resume. */
  abortResolve?: () => void;
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
    // Verify the SDK's native deps (sqlite3) can actually load. If not, the
    // harness hides itself rather than crashing the daemon on first spawn.
    try {
      await loadSdk();
      return true;
    } catch {
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
    if (!apiKey) return [...CURSOR_SDK_FALLBACK_MODELS];

    try {
      const { Cursor } = await loadSdk();
      const models = await withTimeout(
        Cursor.models.list({ apiKey }),
        MODELS_LIST_TIMEOUT_MS,
        'Cursor.models.list'
      );
      const ids = models.map((m) => m.id).filter((id) => id.length > 0);
      return ids.length > 0 ? ids : [...CURSOR_SDK_FALLBACK_MODELS];
    } catch (err) {
      console.warn(
        `[cursor-sdk] Cursor.models.list failed, using fallback list:`,
        err instanceof Error ? err.message : err
      );
      return [...CURSOR_SDK_FALLBACK_MODELS];
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

  override async stop(pid: number): Promise<void> {
    const session = this.sessions.get(pid);
    if (session) {
      session.aborted = true;
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
      if (!session.agentClosed) {
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

  async spawn(options: SpawnOptions): Promise<SpawnResult> {
    const apiKey = process.env.CURSOR_API_KEY?.trim();
    if (!apiKey) {
      throw new Error('CURSOR_API_KEY is not set');
    }

    const keeper = this.deps.spawn(process.execPath, ['-e', 'setInterval(()=>{},2147483647)'], {
      cwd: options.workingDir,
      stdio: 'ignore',
      shell: false,
      detached: true,
    });

    if (!keeper.pid) {
      keeper.kill();
      throw new Error('Failed to spawn cursor-sdk keeper process');
    }

    const pid = keeper.pid;
    const context = options.context;
    const entry = this.registerProcess(pid, context);
    const logPrefix = buildLogPrefix(context);

    const fullPrompt = options.systemPrompt
      ? `${options.systemPrompt}\n\n${options.prompt}`
      : options.prompt;

    const exitCallbacks: Array<
      (info: { code: number | null; signal: string | null; context: SpawnContext }) => void
    > = [];
    const outputCallbacks: (() => void)[] = [];
    const agentEndCallbacks: (() => void)[] = [];

    let agent: SDKAgent;
    try {
      const { Agent } = await loadSdk();
      agent = await withTimeout(
        Agent.create({
          apiKey,
          name: `${context.role}@${context.chatroomId.slice(-6)}`,
          model: { id: resolveModelId(options.model) },
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

    const session: SdkSession = {
      agent,
      keeper,
      aborted: false,
      agentClosed: false,
    };
    this.sessions.set(pid, session);

    const finishExit = (code: number | null, signal: string | null) => {
      this.sessions.delete(pid);
      this.deleteProcess(pid);
      for (const cb of exitCallbacks) {
        cb({ code, signal, context });
      }
    };

    void (async () => {
      let exitCode: number | null = 0;
      let exitSignal: string | null = null;
      let nextPrompt = fullPrompt;
      let isFirstTurn = true;

      try {
        while (!session.aborted) {
          const run = await withTimeout(
            agent.send(nextPrompt, {
              // Clear any wedged run left over from a crashed daemon process,
              // so this message starts fresh instead of getting an agent_busy error.
              local: { force: isFirstTurn },
              // Deduplication key: prevents double-execution if the network drops
              // between send and ack. Unique per turn.
              idempotencyKey: randomUUID(),
            }),
            SEND_TIMEOUT_MS,
            'agent.send'
          );
          session.run = run;
          isFirstTurn = false;

          const adapter = new CursorSdkStreamAdapter(logPrefix);
          adapter.onOutput(() => {
            entry.lastOutputAt = Date.now();
            for (const cb of outputCallbacks) cb();
          });

          for await (const message of run.stream()) {
            if (session.aborted) break;
            adapter.handleMessage(message);
          }

          if (session.aborted) {
            exitCode = 1;
            exitSignal = 'SIGTERM';
            break;
          }

          const result = await withTimeout(run.wait(), RUN_WAIT_TIMEOUT_MS, 'run.wait');
          adapter.finish();

          if (result.status === 'error') {
            exitCode = 2;
            process.stderr.write(`${logPrefix} run-error] run ${result.id} failed\n`);
            break;
          }

          for (const cb of agentEndCallbacks) cb();

          const resumePrompt = await waitForResumeOrAbort(session);
          if (resumePrompt === null || session.aborted) {
            if (session.aborted) {
              exitCode = 1;
              exitSignal = 'SIGTERM';
            }
            break;
          }

          nextPrompt = resumePrompt;
        }
      } catch (err) {
        exitCode = 1;
        const reason = err instanceof Error ? err.message : String(err);
        process.stderr.write(`${logPrefix} spawn-error] ${reason}\n`);
      } finally {
        if (!session.agentClosed) {
          try {
            agent.close();
            session.agentClosed = true;
          } catch {
            // Best-effort
          }
        }

        try {
          keeper.kill();
        } catch {
          // May already be dead
        }

        finishExit(exitCode, exitSignal);
      }
    })();

    return {
      pid,
      onExit: (cb) => {
        exitCallbacks.push(cb);
      },
      onOutput: (cb) => {
        outputCallbacks.push(cb);
      },
      onAgentEnd: (cb) => {
        agentEndCallbacks.push(cb);
      },
    };
  }
}
