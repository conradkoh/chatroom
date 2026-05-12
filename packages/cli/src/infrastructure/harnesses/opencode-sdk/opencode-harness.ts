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
 *   A single Effect fiber (`_sseFiber`) owns the `client.event.subscribe()` call.
 *   It is forked lazily when the first session listener is registered, and
 *   interrupted when the last listener unregisters or the harness is closed.
 *   Events are dispatched to sessions via `session._receiveEvent()`, which pushes
 *   into each session's SseEventBuffer for async consumer delivery.
 */

import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { createOpencodeClient } from '@opencode-ai/sdk';
import type { OpencodeClient, Event as SdkEvent } from '@opencode-ai/sdk';
import { Effect, Schedule, Duration, Fiber } from 'effect';

import type { BoundHarness, ModelInfo, NewSessionConfig, ResumeHarnessSessionOptions, BoundHarnessFactory } from '../../../domain/direct-harness/entities/bound-harness.js';
import type { PublishedAgent, PublishedProvider } from '../../../domain/direct-harness/entities/machine-capabilities.js';
import type { DirectHarnessSession } from '../../../domain/direct-harness/entities/direct-harness-session.js';
import type { OpenCodeSessionId } from '../../../domain/direct-harness/entities/harness-session.js';
import { OpencodeSdkSession } from './opencode-session.js';
import { waitForListeningUrl } from '../../../infrastructure/services/remote-agents/opencode-sdk/parse-listening-url.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Extract sessionID from a raw opencode event (mirrors the same logic in OpencodeSdkSession). */
function harnessEventSessionId(event: SdkEvent): string | undefined {
  const p = event.properties;
  if ('sessionID' in p && typeof p.sessionID === 'string') return p.sessionID;
  if ('part' in p && p.part && typeof p.part === 'object' && 'sessionID' in p.part) {
    return (p.part as { sessionID: string }).sessionID;
  }
  return undefined;
}

// ─── SSE Error types ──────────────────────────────────────────────────────────

class SseSubscribeError {
  readonly _tag = 'SseSubscribeError';
  constructor(readonly cause: unknown) {}
}

class SseStreamError {
  readonly _tag = 'SseStreamError';
  constructor(readonly cause: unknown) {}
}

// ─── Defaults ─────────────────────────────────────────────────────────────────

const OPENCODE_COMMAND = 'opencode';
const SERVE_STARTUP_TIMEOUT_MS = 10_000;

// ─── SSE retry schedule: 500ms → doubles → caps at 30s ───────────────────────

const sseRetrySchedule = Schedule.exponential(Duration.millis(500)).pipe(
  Schedule.either(Schedule.spaced(Duration.seconds(30)))
);

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
   * The single Effect fiber that owns the SSE subscription.
   * Forked on first listener registration; interrupted on last removal or close().
   */
  private _sseFiber: Fiber.RuntimeFiber<void, never> | null = null;

  // ── Debug instrumentation (test-only) ──────────────────────────────────────
  /**
   * Counts harness-level calls to client.event.subscribe() (i.e. calls made by
   * the Effect fiber). Incremented inside buildSseProgram()'s subscribe Effect.
   *
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
   * The program:
   *   1. Calls client.event.subscribe() once.
   *   2. Drains the SSE stream, routing each event to the matching session.
   *   3. On stream end or error, retries with exponential backoff (500ms → 30s cap).
   *
   * The program runs as a Fiber (_sseFiber) and is interrupted via Fiber.interrupt
   * when close() is called or the last session listener is removed.
   */
  private buildSseProgram(): Effect.Effect<void, never, never> {
    const self = this;

    // Step 1: Subscribe — increment debug counter inside the try so it only counts
    // successful subscribe calls from the harness-level fiber.
    const subscribe = Effect.tryPromise({
      try: () => {
        self._subscribeCallCount++;
        return self.client.event.subscribe({ query: { directory: self.cwd } });
      },
      catch: (e) => new SseSubscribeError(e),
    });

    // Step 2: Consume the stream — dispatches events to sessions.
    // Returns Effect<void, SseStreamError> where:
    //   - succeed(void)   → stream ended normally (trigger retry)
    //   - fail(SseStreamError) → stream threw (trigger retry)
    const consume = (
      result: Awaited<ReturnType<typeof self.client.event.subscribe>>
    ): Effect.Effect<void, SseStreamError> =>
      Effect.async<void, SseStreamError>((resume) => {
        let cancelled = false;

        const run = async () => {
          try {
            for await (const raw of result.stream) {
              if (cancelled || self.closed) return;
              const sid = harnessEventSessionId(raw as SdkEvent);
              if (sid) {
                const session = self.sessionListeners.get(sid);
                if (session) {
                  console.log(`[opencode-harness] Routing event type="${(raw as SdkEvent).type}" to session "${sid}"`);
                  session._receiveEvent(raw as SdkEvent);
                } else if ((raw as SdkEvent).type !== 'server.connected') {
                  console.warn(`[opencode-harness] Event type="${(raw as SdkEvent).type}" has sessionID="${sid}" but NO matching listener`);
                }
              } else if ((raw as SdkEvent).type !== 'server.connected') {
                console.log(`[opencode-harness] Event type="${(raw as SdkEvent).type}" has no sessionID (ignored)`);
              }
            }
            // Stream ended normally → trigger retry
            if (!cancelled) resume(Effect.succeed(undefined));
          } catch (e) {
            if (!cancelled) resume(Effect.fail(new SseStreamError(e)));
          }
        };

        void run();

        // Cancellator: called when the Fiber is interrupted
        return Effect.sync(() => {
          cancelled = true;
        });
      });

    // Full program: subscribe → consume → on any error/end, swallow and let schedule retry
    return subscribe.pipe(
      Effect.flatMap(consume),
      Effect.catchAll(() => Effect.void),
      Effect.repeat(sseRetrySchedule),
      // Ensure error channel is never (repeat + catchAll already do this, but be explicit)
      Effect.catchAll(() => Effect.void),
    );
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
    env: {
      ...process.env,
      GIT_EDITOR: 'true',
      GIT_SEQUENCE_EDITOR: 'true',
    },
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
