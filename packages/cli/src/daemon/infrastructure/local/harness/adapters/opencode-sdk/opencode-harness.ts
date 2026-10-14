/**
 * OpencodeSdkHarness — BoundHarness implementation for the opencode V2 client.
 *
 * Lifecycle:
 *   1. `startOpencodeSdkHarness()` spawns `opencode serve --print-logs`,
 *      waits for the listening URL, and returns a BoundHarness.
 *   2. `newSession()` creates a new session and returns an OpencodeSdkSession.
 *   3. `resumeSession()` returns an OpencodeSdkSession for an existing session ID.
 *   4. `models()` reads models from the running server.
 *   5. `isAlive()` checks the child process.
 *   6. `close()` sends SIGTERM and cleans up.
 *
 * SSE architecture (Phase 4+):
 *   A single Effect fiber (`_sseFiber`) owns the SSE event loop.
 *   It is forked lazily when the first session listener is registered, and
 *   interrupted when the last listener unregisters or the harness is closed.
 *   V2 exposes events as a plain AsyncIterable from `client.event.subscribe()`
 *   (no `{ stream }` envelope). The inner loop is a plain async while-loop
 *   (not Effect.callback) to avoid interaction issues between Effect's fiber
 *   scheduler and async iterator stepping.
 */

// fallow-ignore-file code-duplication

import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';

import { OpenCode } from '@opencode/client';
import type { OpenCodeClient, OpenCodeEvent } from '@opencode/client';
import { Effect, Fiber } from 'effect';

import { OpencodeSdkSession } from './opencode-session.js';
import { buildAgentSpawnEnv } from '../../../../../../infrastructure/convex/spawn-env.js';
import type {
  BoundHarness,
  ModelInfo,
  NewSessionConfig,
  ResumeHarnessSessionOptions,
  BoundHarnessFactory,
} from '../../../../../domain/entities/bound-harness.js';
import type { DirectHarnessSession } from '../../../../../domain/entities/direct-harness-session.js';
import type { OpenCodeSessionId } from '../../../../../domain/entities/harness-session.js';
import type {
  PublishedAgent,
  PublishedProvider,
} from '../../../../../domain/entities/machine-capabilities.js';
import { ensureLocation } from '../../services/opencode-sdk/ensure-location.js';
import {
  groupModelsByProvider,
  mapOpencodeProviderModelOptions,
} from '../../services/opencode-sdk/opencode-model-catalog.js';
import {
  serverAuthHeaders,
  waitForListeningUrl,
} from '../../services/opencode-sdk/parse-listening-url.js';
import { requireHarnessModel } from '../../services/require-harness-model.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Extract sessionID from a raw opencode V2 event (`data.sessionID`). */
function harnessEventSessionId(event: OpenCodeEvent): string | undefined {
  const data = event.data as Record<string, unknown> | undefined;
  if (!data || typeof data !== 'object') return undefined;
  const sid = data.sessionID;
  return typeof sid === 'string' ? sid : undefined;
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
  /** OpenCode client instance, already connected to a running server. */
  readonly client: OpenCodeClient;
  /** Child process reference (for isAlive / close). */
  readonly process: ChildProcess;
}

// ─── Implementation ───────────────────────────────────────────────────────────

export class OpencodeSdkHarness implements BoundHarness {
  readonly type = 'opencode-sdk' as const;
  readonly displayName = 'OpenCode (SDK)';

  private readonly client: OpenCodeClient;
  private readonly childProcess: ChildProcess;
  readonly cwd: string;
  private readonly baseUrl: string;
  private closed = false;

  // ── SSE fan-out ─────────────────────────────────────────────────────────────
  /** Sessions listening for events from this harness, keyed by sessionId. */
  private readonly sessionListeners = new Map<string, OpencodeSdkSession>();

  /**
   * The single Effect fiber that owns the SSE subscription loop.
   * Forked on first listener registration; interrupted on last removal or close().
   */
  private _sseFiber: Fiber.Fiber<void, never> | null = null;

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

  /** List available models via the V2 model list. */
  async models(): Promise<readonly ModelInfo[]> {
    const result = await this.client.model.list({ location: { directory: this.cwd } });
    const models = result.data ?? [];

    return models
      .filter((model) => model.enabled !== false)
      .map((model) => ({
        id: `${model.providerID}/${model.modelID}`,
        name: model.name,
        provider: model.providerID,
      }));
  }

  /** List agents configured in this opencode workspace. */
  async listAgents(): Promise<readonly PublishedAgent[]> {
    const result = await this.client.agent.list({ location: { directory: this.cwd } });
    const agents = result.data ?? [];

    return agents
      .filter((agent) => agent.hidden !== true)
      .map((agent) => ({
        // V2 switchAgent/prompt take the agent id, not the display name.
        name: agent.id,
        mode: (agent.mode as PublishedAgent['mode']) ?? 'all',
        ...(agent.description ? { description: agent.description } : {}),
      }));
  }

  /** List providers with their enabled models. */
  async listProviders(): Promise<readonly PublishedProvider[]> {
    const [providersResult, modelsResult] = await Promise.all([
      this.client.provider.list(),
      this.client.model.list({ location: { directory: this.cwd } }),
    ]);
    const providers = providersResult.data ?? [];
    const modelsByProvider = groupModelsByProvider(modelsResult.data ?? []);

    return providers
      .map((provider) => ({
        providerID: provider.id,
        name: provider.name,
        models: mapOpencodeProviderModelOptions(modelsByProvider.get(provider.id) ?? []),
      }))
      .filter((provider) => provider.models.length > 0);
  }

  /** Create a new SDK session. */
  async newSession(config: NewSessionConfig): Promise<DirectHarnessSession> {
    if (this.closed) throw new Error('Harness is closed');
    requireHarnessModel(config.model, 'opencode-sdk newSession');

    const created = await this.client.session.create({
      ...(config.title ? { title: config.title } : {}),
      location: { directory: this.cwd },
    });

    const sessionId = created.id;
    if (!sessionId) {
      throw new Error('Failed to create session: no session ID returned');
    }

    // Fetch the session title from the harness (it auto-generates one)
    let sessionTitle = config.title ?? '';
    try {
      const sessionInfo = await this.client.session.get({ sessionID: sessionId });
      sessionTitle = sessionInfo.title ?? sessionTitle;
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

  /** Resume an existing session by its session ID. */
  async resumeSession(
    sessionId: OpenCodeSessionId,
    _options?: ResumeHarnessSessionOptions
  ): Promise<DirectHarnessSession> {
    if (this.closed) throw new Error('Harness is closed');

    // Verify the session still exists
    let sessionTitle = '';
    try {
      const sessionInfo = await this.client.session.get({ sessionID: sessionId });
      sessionTitle = sessionInfo.title ?? '';
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
   * Route one raw V2 event to the session that owns it.
   */
  private processEventLine(raw: OpenCodeEvent): void {
    try {
      this._routeEvent(raw);
    } catch (e) {
      console.warn('[opencode-harness] Error routing event:', e);
    }
  }

  private async drainEventStream(
    stream: AsyncIterable<OpenCodeEvent>,
    interrupted: () => boolean
  ): Promise<void> {
    const iterator = stream[Symbol.asyncIterator]();
    try {
      while (!interrupted() && !this.closed) {
        let next: IteratorResult<OpenCodeEvent>;
        try {
          next = await iterator.next();
        } catch {
          break;
        }
        if (next.done || interrupted() || this.closed) break;

        this.processEventLine(next.value);
      }
    } finally {
      try {
        await iterator.return?.();
      } catch (error) {
        console.warn('[opencode-harness] SSE iterator cleanup error:', error);
      }
    }
  }

  private buildSseProgram(): Effect.Effect<void, never, never> {
    const self = this;

    return Effect.callback<void, never>((resume) => {
      const state = { interrupted: false, abortController: null as AbortController | null };
      const loopDone = self._sseRunLoop(state, resume).catch((error: unknown) => {
        console.warn('[opencode-harness] SSE loop error:', error);
        resume(Effect.succeed(undefined));
      });
      return Effect.promise(async () => {
        state.interrupted = true;
        state.abortController?.abort();
        await loopDone;
      });
    });
  }

  private async _sseRunLoop(
    state: { interrupted: boolean; abortController: AbortController | null },
    resume: (eff: Effect.Effect<void, never, never>) => void
  ): Promise<void> {
    while (this._sseShouldContinue(state)) {
      try {
        const stream = this._sseSubscribeUntilStream(state);
        if (stream) {
          await this.drainEventStream(stream, () => state.interrupted);
        }
      } finally {
        state.abortController = null;
      }
      await this._sseSleepIfActive(100, state);
    }
    resume(Effect.succeed(undefined));
  }

  private _sseShouldContinue(state: { interrupted: boolean }): boolean {
    return !state.interrupted && !this.closed;
  }

  private async _sseSleepIfActive(ms: number, state: { interrupted: boolean }): Promise<void> {
    if (!state.interrupted && !this.closed) {
      await new Promise<void>((r) => setTimeout(r, ms));
    }
  }

  private _sseSubscribeUntilStream(state: {
    interrupted: boolean;
    abortController: AbortController | null;
  }): AsyncIterable<OpenCodeEvent> | null {
    state.abortController = new AbortController();
    this._subscribeCallCount++;
    try {
      return this.client.event.subscribe({ signal: state.abortController.signal });
    } catch {
      console.warn('[opencode-harness] SSE subscribe error');
      return null;
    }
  }

  /** Fetch the current title of a session directly from the OpenCode API. */
  async fetchSessionTitle(opencodeSessionId: string): Promise<string | undefined> {
    try {
      const info = await this.client.session.get({ sessionID: opencodeSessionId });
      return info.title ?? undefined;
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

  private _routeEvent(raw: OpenCodeEvent): void {
    const sid = harnessEventSessionId(raw);
    if (sid) {
      const session = this.sessionListeners.get(sid);
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
  }

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
  const childProcess = spawn(OPENCODE_COMMAND, ['serve', '--print-logs', '--log-level', 'warn'], {
    cwd: config.workingDir,
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: false,
    env: buildAgentSpawnEnv(config.resolvedConvexUrl),
  });

  if (!childProcess.pid) {
    throw new Error('Failed to spawn opencode serve process');
  }

  try {
    const { url, password } = await waitForListeningUrl(childProcess, {
      timeoutMs: SERVE_STARTUP_TIMEOUT_MS,
    });

    const headers = serverAuthHeaders(password);
    const client = OpenCode.make({ baseUrl: url, ...(headers ? { headers } : {}) });
    await ensureLocation(client, config.workingDir);

    return new OpencodeSdkHarness({
      baseUrl: url,
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
