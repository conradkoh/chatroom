/**
 * OpencodeSdkHarness — BoundHarness implementation for the opencode SDK.
 *
 * Lifecycle:
 *   1. `startOpencodeSdkHarness()` spawns `opencode serve --print-logs`,
 *      waits for the listening URL, and returns a BoundHarness.
 *   2. `newSession()` creates a new SDK session and returns an OpencodeSdkSession.
 *   3. `resumeSession()` returns an OpencodeSdkSession for an existing session ID.
 *   4. `models()` reads providers/models from the running SDK server.
 *   5. `isAlive()` checks the child process.
 *   6. `close()` sends SIGTERM and cleans up.
 *
 * SSE architecture (Phase 4+):
 *   A single Effect fiber (`_sseFiber`) owns the SSE event loop.
 *   It is forked lazily when the first session listener is registered, and
 *   interrupted when the last listener unregisters or the harness is closed.
 *   The inner loop is a plain async while-loop (not Effect.async) to avoid
 *   interaction issues between Effect's fiber scheduler and async iterator stepping.
 *   Events are dispatched to sessions via `session._receiveEvent()`, which pushes
 *   into each session's SseEventBuffer for async consumer delivery.
 */

import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';

import { createOpencodeClient } from '@opencode-ai/sdk';
import type { OpencodeClient, Event as SdkEvent, GlobalEvent } from '@opencode-ai/sdk';
import { Effect, Fiber } from 'effect';

import { OpencodeSdkSession } from './opencode-session.js';
import type {
  BoundHarness,
  ModelInfo,
  NewSessionConfig,
  ResumeHarnessSessionOptions,
  BoundHarnessFactory,
} from '../../../domain/direct-harness/entities/bound-harness.js';
import type { DirectHarnessSession } from '../../../domain/direct-harness/entities/direct-harness-session.js';
import type { OpenCodeSessionId } from '../../../domain/direct-harness/entities/harness-session.js';
import type {
  PublishedAgent,
  PublishedProvider,
} from '../../../domain/direct-harness/entities/machine-capabilities.js';
import { waitForListeningUrl } from '../../../infrastructure/services/remote-agents/opencode-sdk/parse-listening-url.js';
import { buildChatroomSpawnEnv } from '../../convex/spawn-env.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Extract sessionID from a raw opencode event payload. */
function harnessEventSessionId(event: SdkEvent): string | undefined {
  const p = event.properties;
  if (!p) return undefined;
  if ('sessionID' in p && typeof p.sessionID === 'string') return p.sessionID;
  if ('part' in p && p.part && typeof p.part === 'object' && 'sessionID' in p.part) {
    return (p.part as { sessionID: string }).sessionID;
  }
  return undefined;
}

// ─── Defaults ─────────────────────────────────────────────────────────────────

const OPENCODE_COMMAND = 'opencode';
const SERVE_STARTUP_TIMEOUT_MS = 10_000;

// ─── Options ──────────────────────────────────────────────────────────────────

export interface OpencodeSdkHarnessOptions {
  /** Base URL of the running opencode server (e.g. http://127.0.0.1:15432). */
  readonly baseUrl: string;
  /** Working directory for the harness process. */
  readonly cwd: string;
  /** OpenCode SDK client instance, already connected to a running server. */
  readonly client: OpencodeClient;
  /** Child process reference (for isAlive / close). */
  readonly process: ChildProcess;
}

// ─── Implementation ───────────────────────────────────────────────────────────

export class OpencodeSdkHarness implements BoundHarness {
  readonly type = 'opencode-sdk' as const;
  readonly displayName = 'Opencode';

  private readonly client: OpencodeClient;
  private readonly childProcess: ChildProcess;
  readonly cwd: string;
  private readonly baseUrl: string;
  private closed = false;

  // ── SSE fan-out ─────────────────────────────────────────────────────────────
  /** Sessions listening for events from this harness, keyed by opencodeSessionId. */
  private readonly sessionListeners = new Map<string, OpencodeSdkSession>();

  /**
   * The single Effect fiber that owns the SSE subscription loop.
   * Forked on first listener registration; interrupted on last removal or close().
   */
  private _sseFiber: Fiber.RuntimeFiber<void, never> | null = null;

  // ── Debug instrumentation (test-only) ──────────────────────────────────────
  /**
   * Counts harness-level calls to client.event.subscribe().
   * TEST-ONLY — used by integration tests to assert single-subscribe behaviour.
   */
  private _subscribeCallCount = 0;

  _debugSubscribeCount(): number {
    return this._subscribeCallCount;
  }

  constructor(options: OpencodeSdkHarnessOptions) {
    this.client = options.client;
    this.childProcess = options.process;
    this.cwd = options.cwd;
    this.baseUrl = options.baseUrl;
  }

  /** List available models via the opencode provider list. */
  async models(): Promise<readonly ModelInfo[]> {
    const result = await this.client.provider.list();
    const providers = result.data?.all ?? [];

    const models: ModelInfo[] = [];
    for (const provider of providers) {
      for (const [key, model] of Object.entries(provider.models ?? {})) {
        models.push({
          id: key, // e.g. "openai/gpt-4"
          name: model.name,
          provider: provider.name,
        });
      }
    }
    return models;
  }

  /** List agents configured in this opencode workspace. */
  async listAgents(): Promise<readonly PublishedAgent[]> {
    const result = await this.client.config.get();
    const agentMap = result.data?.agent ?? {};

    return Object.entries(agentMap)
      .filter(([, cfg]) => cfg !== undefined && cfg.disable !== true)
      .map(([name, cfg]) => ({
        name,
        mode: (cfg?.mode as PublishedAgent['mode']) ?? 'all',
        ...(cfg?.description ? { description: cfg.description } : {}),
      }));
  }

  /** List connected providers and their models. */
  async listProviders(): Promise<readonly PublishedProvider[]> {
    const result = await this.client.provider.list();
    const all = result.data?.all ?? [];
    const connected = new Set(result.data?.connected ?? []);

    return all
      .filter((p) => connected.has(p.id))
      .map((p) => ({
        providerID: p.id,
        name: p.name,
        models: Object.entries(p.models ?? {}).map(([modelID, m]) => ({
          modelID,
          name: m.name,
        })),
      }));
  }

  /** Create a new SDK session. */
  async newSession(config: NewSessionConfig): Promise<DirectHarnessSession> {
    if (this.closed) throw new Error('Harness is closed');

    const created = await this.client.session.create({
      body: {
        ...(config.title ? { title: config.title } : {}),
      },
      query: {
        directory: this.cwd,
      },
    });

    const sessionId = created.data?.id;
    if (!sessionId) {
      throw new Error('Failed to create session: no session ID returned');
    }

    // Fetch the session title from the harness (it auto-generates one)
    let sessionTitle = config.title ?? '';
    try {
      const sessionInfo = await this.client.session.get({
        path: { id: sessionId },
      });
      sessionTitle = sessionInfo.data?.title ?? sessionTitle;
    } catch {
      // Non-fatal — fall back to the requested title or empty string
    }

    const session = new OpencodeSdkSession({
      client: this.client,
      opencodeSessionId: sessionId,
      sessionTitle,
      cwd: this.cwd,
      onClose: (id) => this.unregisterSessionListener(id),
    });
    this.registerSessionListener(sessionId, session);
    return session;
  }

  /** Resume an existing SDK session by its harness session ID. */
  async resumeSession(
    sessionId: OpenCodeSessionId,
    _options?: ResumeHarnessSessionOptions
  ): Promise<DirectHarnessSession> {
    if (this.closed) throw new Error('Harness is closed');

    // Verify the session still exists
    let sessionTitle = '';
    try {
      const sessionInfo = await this.client.session.get({
        path: { id: sessionId },
      });
      sessionTitle = sessionInfo.data?.title ?? '';
    } catch {
      throw new Error(`Session ${sessionId} not found on the harness`);
    }

    const session = new OpencodeSdkSession({
      client: this.client,
      opencodeSessionId: sessionId,
      sessionTitle,
      cwd: this.cwd,
      onClose: (id) => this.unregisterSessionListener(id),
    });
    this.registerSessionListener(sessionId, session);
    return session;
  }

  /** Whether the underlying process is still alive. */
  isAlive(): boolean {
    if (this.closed) return false;
    return this.childProcess.exitCode === null && this.childProcess.killed === false;
  }

  // ── SSE fan-out lifecycle ────────────────────────────────────────────────────

  /**
   * Register a session to receive events from the harness-level SSE stream.
   * Forks the single SSE fiber on first registration.
   */
  registerSessionListener(opencodeSessionId: string, session: OpencodeSdkSession): void {
    this.sessionListeners.set(opencodeSessionId, session);
    console.log(`[opencode-harness] Registered session listener: "${opencodeSessionId}"`);
    if (this._sseFiber === null && !this.closed) {
      this._sseFiber = Effect.runFork(this.buildSseProgram());
    }
  }

  /**
   * Unregister a session from the SSE fan-out map.
   * Interrupts the fiber when the last listener is removed.
   */
  unregisterSessionListener(opencodeSessionId: string): void {
    this.sessionListeners.delete(opencodeSessionId);
    console.log(`[opencode-harness] Unregistered session listener: "${opencodeSessionId}"`);
    if (this.sessionListeners.size === 0 && this._sseFiber !== null) {
      const fiber = this._sseFiber;
      this._sseFiber = null;
      // Fire-and-forget interrupt when no more sessions are listening
      Effect.runFork(Fiber.interrupt(fiber));
    }
  }

  // ── Effect SSE program ───────────────────────────────────────────────────────

  /**
   * Builds the Effect program that manages the single SSE subscription.
   *
   * Wraps a plain async while-loop in Effect.async so it can be managed
   * as an interruptible Fiber. The inner loop uses direct iterator.next()
   * calls (not for-await) to avoid interaction issues between Effect's
   * fiber scheduler and JavaScript's async iterator protocol.
   *
   * On stream end or error, reconnects immediately (no backoff) to minimize
   * the window where events could be missed during reconnection.
   */
  private buildSseProgram(): Effect.Effect<void, never, never> {
    const self = this;

    return Effect.async<void, never>((resume) => {
      let interrupted = false;
      let abortController: AbortController | null = null;

      const runLoop = async (): Promise<void> => {
        while (!interrupted && !self.closed) {
          // Subscribe to the global event stream (/global/event) which stays alive
          // in serve mode and delivers events for all directories with a wrapping
          // { directory, payload } envelope.
          self._subscribeCallCount++;
          let result: Awaited<ReturnType<typeof self.client.global.event>> | null = null;
          abortController = new AbortController();
          try {
            result = await self.client.global.event({ signal: abortController.signal } as never);
          } catch (e) {
            if (interrupted || self.closed) break;
            console.warn('[opencode-harness] SSE subscribe error:', e);
            // Brief pause before retry on subscribe error
            await new Promise<void>((r) => setTimeout(r, 500));
            continue;
          } finally {
            abortController = null;
          }

          if (interrupted || self.closed) break;

          // Guard: subscribe returned null/undefined (shouldn't happen in production,
          // but guards against cleared mocks in tests or unexpected SDK behavior).
          if (!result || !(result as { stream?: unknown }).stream) {
            await new Promise<void>((r) => setTimeout(r, 100));
            continue;
          }

          // Drain the global event stream using manual iterator.next() calls
          // (avoids for-await cleanup semantics that can close the iterator early)
          const iterator = (result.stream as AsyncIterable<unknown>)[Symbol.asyncIterator]();
          try {
            while (!interrupted && !self.closed) {
              let next: IteratorResult<unknown>;
              try {
                next = await iterator.next();
              } catch {
                break; // stream error — reconnect
              }
              if (next.done) break; // stream ended — reconnect

              const globalEvent = next.value as GlobalEvent;
              const raw = globalEvent.payload as SdkEvent;
              try {
                const sid = harnessEventSessionId(raw);
                if (sid) {
                  const session = self.sessionListeners.get(sid);
                  if (session) {
                    session._receiveEvent(raw);
                  } else {
                    console.warn(
                      `[opencode-harness] Event type="${raw.type}" has sessionID="${sid}" but NO matching listener`
                    );
                  }
                } else if (raw?.type !== 'server.connected') {
                  // Silently ignore events without a sessionID (e.g. sync, project.updated)
                }
              } catch (e) {
                // Never let event routing crash the loop
                console.warn('[opencode-harness] Error routing event:', e);
              }
            }
          } finally {
            // Always release the iterator when we exit the inner loop
            void iterator.return?.();
          }
          // Stream ended or errored — short pause before reconnect
          // (avoids tight CPU loop if server closes immediately after connect)
          if (!interrupted && !self.closed) {
            await new Promise<void>((r) => setTimeout(r, 100));
          }
        }
        // Outer loop exited cleanly — signal the fiber is done
        resume(Effect.succeed(undefined));
      };

      void runLoop();

      // Interruption handler: signal the loop to stop and abort any in-flight subscribe
      return Effect.sync(() => {
        interrupted = true;
        abortController?.abort();
      });
    });
  }

  /** Fetch the current title of a session directly from the OpenCode API. */
  async fetchSessionTitle(opencodeSessionId: string): Promise<string | undefined> {
    try {
      const info = await this.client.session.get({ path: { id: opencodeSessionId } });
      return info.data?.title ?? undefined;
    } catch {
      return undefined;
    }
  }

  /** Tear down the harness process and release all resources. */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    // Interrupt the SSE fiber (if running) and wait for it to stop
    if (this._sseFiber !== null) {
      const fiber = this._sseFiber;
      this._sseFiber = null;
      await Effect.runPromise(Fiber.interrupt(fiber));
    }

    this.sessionListeners.clear();

    // Send SIGTERM, then SIGKILL after a grace period
    this.childProcess.kill('SIGTERM');

    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        this.childProcess.kill('SIGKILL');
        resolve();
      }, 5_000);

      this.childProcess.once('exit', () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /** Return the base URL of the running opencode server. */
  private getBaseUrl(): string {
    return this.baseUrl;
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Factory function: spawn the opencode process, wait for the URL, create the
 * client, and return a BoundHarness.
 */
export const startOpencodeSdkHarness: BoundHarnessFactory = async (config) => {
  const childProcess = spawn(OPENCODE_COMMAND, ['serve', '--print-logs'], {
    cwd: config.workingDir,
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: false,
    env: buildChatroomSpawnEnv(config.resolvedConvexUrl, {
      GIT_EDITOR: 'true',
      GIT_SEQUENCE_EDITOR: 'true',
    }),
  });

  if (!childProcess.pid) {
    throw new Error('Failed to spawn opencode serve process');
  }

  try {
    const baseUrl = await waitForListeningUrl(childProcess, {
      timeoutMs: SERVE_STARTUP_TIMEOUT_MS,
    });

    const client = createOpencodeClient({ baseUrl });

    return new OpencodeSdkHarness({
      baseUrl,
      cwd: config.workingDir,
      client: client,
      process: childProcess,
    });
  } catch (err) {
    // Kill the process on any startup failure
    childProcess.kill('SIGKILL');
    throw err;
  }
};
