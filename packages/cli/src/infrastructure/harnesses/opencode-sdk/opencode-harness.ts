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
 */

import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { createOpencodeClient } from '@opencode-ai/sdk';
import type { OpencodeClient } from '@opencode-ai/sdk';

import type { BoundHarness, ModelInfo, NewSessionConfig, ResumeHarnessSessionOptions, BoundHarnessFactory } from '../../../domain/direct-harness/entities/bound-harness.js';
import type { PublishedAgent, PublishedProvider } from '../../../domain/direct-harness/entities/machine-capabilities.js';
import type { DirectHarnessSession } from '../../../domain/direct-harness/entities/direct-harness-session.js';
import type { OpenCodeSessionId } from '../../../domain/direct-harness/entities/harness-session.js';
import { OpencodeSdkSession } from './opencode-session.js';
import { waitForListeningUrl } from '../../../infrastructure/services/remote-agents/opencode-sdk/parse-listening-url.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Extract sessionID from a raw opencode event (mirrors the same logic in OpencodeSdkSession). */
function harnessEventSessionId(event: { properties?: Record<string, unknown> }): string | undefined {
  const p = event.properties;
  if (!p || typeof p !== 'object') return undefined;
  if ('sessionID' in p && typeof p.sessionID === 'string') return p.sessionID;
  const part = (p as Record<string, unknown>).part;
  if (part && typeof part === 'object' && 'sessionID' in part && typeof (part as Record<string, unknown>).sessionID === 'string') {
    return (part as Record<string, unknown>).sessionID as string;
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

  // ── SSE fan-out ──────────────────────────────────────────────────────────────────
  /** Sessions listening for events from this harness, keyed by opencodeSessionId. */
  private readonly sessionListeners = new Map<string, OpencodeSdkSession>();
  /** True while the shared SSE event loop is running. Guards against double-start. */
  private eventLoopRunning = false;
  /** Set to true to signal the event loop to stop on next iteration. */
  private eventLoopStopped = false;

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

  // ── SSE fan-out lifecycle ───────────────────────────────────────────────────────────────

  /**
   * Register a session to receive events from the harness-level SSE stream.
   * Starts the shared event loop if it’s not already running.
   */
  registerSessionListener(opencodeSessionId: string, session: OpencodeSdkSession): void {
    this.sessionListeners.set(opencodeSessionId, session);
    console.log(`[opencode-harness] Registered session listener: "${opencodeSessionId}"`);
    if (!this.eventLoopRunning) {
      this.eventLoopRunning = true;
      this.eventLoopStopped = false;
      void this.runEventLoop().catch((err) => {
        if (!this.closed) console.warn('[opencode-harness] SSE event loop error:', err);
      });
    }
  }

  /**
   * Unregister a session from the SSE fan-out map.
   * Signals the event loop to stop when the last listener is removed.
   */
  unregisterSessionListener(opencodeSessionId: string): void {
    this.sessionListeners.delete(opencodeSessionId);
    console.log(`[opencode-harness] Unregistered session listener: "${opencodeSessionId}"`);
    if (this.sessionListeners.size === 0) {
      this.eventLoopStopped = true;
    }
  }

  /**
   * Shared SSE event loop.
   *
   * Subscribes once to `client.event.subscribe()`, then dispatches every
   * received event to the registered session whose opencodeSessionId matches
   * `harnessEventSessionId(event)`. Runs until the harness is closed or the
   * last session listener unregisters.
   *
   * Retries indefinitely with exponential backoff (500ms → 30s) when the
   * stream ends or errors. Backoff resets to 500ms after a successful stream
   * that delivered at least one event.
   */
  private async runEventLoop(): Promise<void> {
    let attempt = 0;
    let delayMs = 500;
    const MAX_DELAY_MS = 30_000;

    while (!this.closed && !this.eventLoopStopped) {
      attempt++;
      let eventCount = 0;
      try {
        console.log(`[opencode-harness] Subscribing to SSE events for directory: ${this.cwd} (attempt ${attempt})`);
        const result = await this.client.event.subscribe({ query: { directory: this.cwd } } as Parameters<typeof this.client.event.subscribe>[0]);
        const stream = (result as unknown as { stream: AsyncGenerator<unknown> }).stream;
        const iterator = stream[Symbol.asyncIterator]();
        while (true) {
          let next: IteratorResult<unknown>;
          try {
            next = await iterator.next();
          } catch {
            // Stream error — break inner loop and retry
            break;
          }
          if (next.done || this.closed || this.eventLoopStopped) break;
          eventCount++;
          const raw = next.value as { type: string; properties?: Record<string, unknown> };
          const sid = harnessEventSessionId(raw);
          const registeredSessions = [...this.sessionListeners.keys()];
          if (sid) {
            const found = this.sessionListeners.has(sid);
            if (!found) {
              console.warn(`[opencode-harness] Event type="${raw.type}" has sessionID="${sid}" but NO matching listener (registered: ${registeredSessions.join(',') || 'none'})`);
            } else {
              console.log(`[opencode-harness] Routing event type="${raw.type}" to session "${sid}"`);
            }
          } else if (raw.type !== 'server.connected') {
            console.log(`[opencode-harness] Event type="${raw.type}" has no sessionID (ignored)`);
          }
          if (sid) {
            this.sessionListeners.get(sid)?._receiveEvent(raw);
          }
        }
        if (this.closed || this.eventLoopStopped) break; // clean exit
        // Reset backoff when the stream was healthy and delivered events
        if (eventCount > 0) {
          delayMs = 500;
        }
      } catch {
        if (this.closed || this.eventLoopStopped) break;
      }

      if (this.closed || this.eventLoopStopped) break;

      console.warn(
        `[opencode-harness] SSE stream ended, reconnecting in ${delayMs}ms (attempt ${attempt})...`
      );

      // Wait with backoff, but exit early if the loop is stopped
      await this._sleepWithEarlyExit(delayMs);

      delayMs = Math.min(delayMs * 2, MAX_DELAY_MS);
    }
    this.eventLoopRunning = false;
  }

  /**
   * Sleep for `ms` milliseconds, but resolve immediately if the harness is
   * closed or the event loop is stopped. Polls every 50ms.
   */
  private _sleepWithEarlyExit(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        clearInterval(poll);
        resolve();
      }, ms);
      const poll = setInterval(() => {
        if (this.closed || this.eventLoopStopped) {
          clearTimeout(timer);
          clearInterval(poll);
          resolve();
        }
      }, 50);
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
    // Signal the SSE event loop to stop
    this.eventLoopStopped = true;
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
      client: client as unknown as OpencodeClient,
      process: childProcess,
    });
  } catch (err) {
    // Kill the process on any startup failure
    childProcess.kill('SIGKILL');
    throw err;
  }
};
