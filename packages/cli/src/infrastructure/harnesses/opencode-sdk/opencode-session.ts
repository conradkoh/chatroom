import type { OpencodeClient, Event as SdkEvent } from '@opencode-ai/sdk';
import type { DirectHarnessSession, DirectHarnessSessionEvent, PromptInput } from '../../../domain/direct-harness/entities/direct-harness-session.js';
import type { OpenCodeSessionId } from '../../../domain/direct-harness/entities/harness-session.js';
import { SseEventBuffer } from './sse-event-buffer.js';

function toSessionEvent(event: SdkEvent): DirectHarnessSessionEvent {
  return { type: event.type, payload: event.properties ?? {}, timestamp: Date.now() };
}

export interface OpencodeSdkSessionOptions {
  /** The shared HTTP client from the parent harness. */
  readonly client: OpencodeClient;
  readonly opencodeSessionId: string;
  readonly sessionTitle: string;
  /** The working directory for the harness. */
  readonly cwd: string;
  /**
   * Called when the session is closed so the parent harness can unregister
   * the session from its SSE fan-out map.
   */
  readonly onClose?: (opencodeSessionId: string) => void;
}

export class OpencodeSdkSession implements DirectHarnessSession {
  readonly opencodeSessionId: OpenCodeSessionId;
  /** Backing field for sessionTitle to allow mutation via setTitle(). */
  private _sessionTitle: string;
  get sessionTitle(): string { return this._sessionTitle; }

  private readonly client: OpencodeClient;
  private readonly options: OpencodeSdkSessionOptions;
  private readonly onEventListeners = new Set<(event: DirectHarnessSessionEvent) => void>();
  private closed = false;
  /** Resolve callback to unblock prompt() when session.idle arrives via SSE. */
  private _idleResolve: (() => void) | null = null;

  // ── Buffer consumer ───────────────────────────────────────────────────────────
  /** Per-session event buffer — harness fan-out pushes raw SDK events; consumer drains them. */
  private readonly _buffer: SseEventBuffer<SdkEvent>;
  /** True once the async consumer loop has been started (lazy, first-onEvent). */
  private _consumerStarted = false;
  /**
   * Resolves when the consumer loop exits (either buffer closed or session closed).
   * Awaited in close() so listeners are still registered while draining.
   */
  private _consumerDone: Promise<void> = Promise.resolve();

  constructor(options: OpencodeSdkSessionOptions) {
    this.options = options;
    this.opencodeSessionId = options.opencodeSessionId as OpenCodeSessionId;
    this._sessionTitle = options.sessionTitle;
    this.client = options.client;
    this._buffer = new SseEventBuffer<SdkEvent>();
  }

  async prompt(input: PromptInput): Promise<void> {
    if (this.closed) throw new Error('Session is closed');
    // Create a promise that resolves when session.idle arrives via SSE.
    // The idle event signals that the LLM has finished generating.
    const idlePromise = new Promise<void>((resolve) => {
      this._idleResolve = resolve;
    });

    const IDLE_TIMEOUT_MS = 300_000; // 5 minutes
    const timeoutPromise = new Promise<void>((_, reject) => {
      setTimeout(() => reject(new Error('Timed out waiting for session.idle')), IDLE_TIMEOUT_MS);
    });

    // Submit prompt asynchronously — returns 204 immediately; content comes via SSE.
    await this.client.session.promptAsync({
      path: { id: this.opencodeSessionId },
      body: {
        agent: input.agent,
        parts: input.parts.map((p) => ({ type: 'text' as const, text: p.text })),
        ...(input.model ? { model: input.model } : {}),
        ...(input.system ? { system: input.system } : {}),
        ...(input.tools ? { tools: input.tools } : {}),
      },
    });

    console.log(`[opencode-session] promptAsync submitted for session ${this.opencodeSessionId}, waiting for session.idle via SSE`);

    // Wait for session.idle (delivered by the harness SSE fan-out) or timeout.
    try {
      await Promise.race([idlePromise, timeoutPromise]);
      console.log(`[opencode-session] session.idle received via SSE for session ${this.opencodeSessionId}`);
    } catch (err) {
      console.warn(`[opencode-session] ${err instanceof Error ? err.message : String(err)} — session ${this.opencodeSessionId}`);
      // On timeout, emit session.idle manually as fallback so the pipeline can finalize.
      this._emit({ type: 'session.idle', payload: {}, timestamp: Date.now() });
    } finally {
      this._idleResolve = null;
    }

    console.log(`[opencode-session] prompt() completed for session ${this.opencodeSessionId}`);
  }

  onEvent(listener: (event: DirectHarnessSessionEvent) => void): () => void {
    this.onEventListeners.add(listener);
    // Start the buffer consumer lazily on first registration.
    // Events are delivered exclusively through the consumer loop (harness fan-out → buffer → consumer).
    if (!this._consumerStarted && !this.closed) {
      this._consumerStarted = true;
      this._consumerDone = this._startConsumer().catch((err) => {
        if (!this.closed) console.warn('[opencode-session] consumer error:', err);
      });
    }
    return () => { this.onEventListeners.delete(listener); };
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    // Close the buffer so the consumer drains remaining events and exits naturally.
    // MUST happen before onEventListeners.clear() so listeners are still registered
    // while the consumer drains.
    this._buffer.close();
    // Wait for the consumer to finish draining all buffered events.
    await this._consumerDone;
    try {
      await this.client.session.abort({ path: { id: this.opencodeSessionId } });
    } catch (err) {
      if (!isHttpError(err, 404)) throw err;
    }
    this.onEventListeners.clear();
    this.options.onClose?.(this.opencodeSessionId as string);
  }

  setTitle(title: string): void {
    this._sessionTitle = title;
  }

  /**
   * Receive a raw SDK event from the harness-level SSE fan-out loop.
   * Pushes the event into the per-session buffer for the consumer to drain.
   */
  _receiveEvent(raw: SdkEvent): void {
    this._buffer.push(raw);
  }

  _emit(event: DirectHarnessSessionEvent): void {
    for (const listener of this.onEventListeners) listener(event);
  }

  // ── Buffer consumer ─────────────────────────────────────────────────────────

  /**
   * Async consumer loop — drains raw SDK events from the buffer, converts them to
   * DirectHarnessSessionEvents, and dispatches to registered listeners.
   *
   * Also resolves the in-flight prompt()'s idle promise when session.idle arrives.
   *
   * Runs until the buffer is closed (i.e., close() is called).
   * This is the sole event-delivery path — events arrive from the harness Effect fiber
   * via _receiveEvent(), are buffered, and drained here.
   */
  private async _startConsumer(): Promise<void> {
    for await (const raw of this._buffer) {
      const evt = toSessionEvent(raw);
      for (const l of this.onEventListeners) l(evt);
      if (raw.type === 'session.idle') this._idleResolve?.();
    }
  }
}

function isHttpError(err: unknown, statusCode: number): boolean {
  return !!(err && typeof err === 'object' && 'status' in err && (err as { status: number }).status === statusCode);
}
