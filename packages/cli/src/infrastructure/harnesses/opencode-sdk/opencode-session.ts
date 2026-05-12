import type { OpencodeClient, Event as SdkEvent, Part } from '@opencode-ai/sdk';
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
  /** The working directory for the harness — passed as the `directory` query param to SSE subscribe. */
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
  private readonly cwd: string;
  private readonly onEventListeners = new Set<(event: DirectHarnessSessionEvent) => void>();
  private closed = false;
  /** True while the per-session SSE stream loop is running. */
  private sseRunning = false;
  /** Set to true to stop the SSE loop (session closed or no more listeners). */
  private sseStopped = false;
  /** Cumulative count of SSE events received across all streams for this session. */
  private _sseEventCount = 0;
  /** Set to true when at least one SSE event is received during the current prompt() call. */
  private _sseDeliveredForCurrentPrompt = false;
  /** Resolve callback to unblock prompt() when session.idle arrives via SSE. */
  private _idleResolve: (() => void) | null = null;

  // ── Buffer consumer (Phase 3) ─────────────────────────────────────────────────
  /** Per-session event buffer — harness fan-out pushes raw SDK events; consumer drains them. */
  private readonly _buffer: SseEventBuffer<SdkEvent>;
  /** True once the async consumer loop has been started (lazy, first-onEvent). */
  private _consumerStarted = false;
  /**
   * Resolves when the consumer loop exits (either buffer closed or session closed).
   * Awaited in close() so listeners are still registered while draining.
   */
  private _consumerDone: Promise<void> = Promise.resolve();

  get sseDeliveredForCurrentPrompt(): boolean { return this._sseDeliveredForCurrentPrompt; }

  constructor(options: OpencodeSdkSessionOptions) {
    this.options = options;
    this.opencodeSessionId = options.opencodeSessionId as OpenCodeSessionId;
    this._sessionTitle = options.sessionTitle;
    this.client = options.client;
    this.cwd = options.cwd;
    this._buffer = new SseEventBuffer<SdkEvent>();
  }

  async prompt(input: PromptInput): Promise<void> {
    if (this.closed) throw new Error('Session is closed');
    this._sseDeliveredForCurrentPrompt = false;

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

    // Wait for session.idle (delivered by SSE) or timeout.
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

    console.log(`[opencode-session] prompt() completed: sseEvents=${this._sseEventCount} session=${this.opencodeSessionId}`);
  }

  onEvent(listener: (event: DirectHarnessSessionEvent) => void): () => void {
    this.onEventListeners.add(listener);
    // Start the buffer consumer lazily on first registration.
    if (!this._consumerStarted && !this.closed) {
      this._consumerStarted = true;
      this._consumerDone = this._startConsumer().catch((err) => {
        if (!this.closed) console.warn('[opencode-session] consumer error:', err);
      });
    }
    // Start per-session SSE stream on first subscriber
    // TODO(step-5): remove transitional per-session SSE loop (startEventStream) when
    // harness Effect loop is wired (step 4) and proven stable. The consumer above is
    // the replacement; both run in parallel during the transitional phase.
    if (!this.sseRunning && !this.closed) {
      this.sseRunning = true;
      this.sseStopped = false;
      void this.startEventStream();
    }
    // Event delivery is also managed by the parent harness's SSE fan-out loop.
    return () => { this.onEventListeners.delete(listener); };
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.sseStopped = true; // Stop the per-session SSE loop
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
   *
   * NOTE: direct dispatch has been removed from this method. Events are now
   * delivered to listeners exclusively through the async consumer loop (_startConsumer).
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
   *
   * TODO(step-5): remove transitional dual-dispatch comment — after startEventStream()
   * is deleted in step 5, this consumer is the sole event-delivery path.
   */
  private async _startConsumer(): Promise<void> {
    for await (const raw of this._buffer) {
      const evt = toSessionEvent(raw);
      this._sseEventCount++;
      this._sseDeliveredForCurrentPrompt = true;
      // TODO(step-5): remove transitional dual-dispatch — both this consumer and
      // startEventStream() deliver events during the transitional phase (step 3).
      // After step 5 removes startEventStream(), this is the only dispatch path.
      for (const l of this.onEventListeners) l(evt);
      if (raw.type === 'session.idle') this._idleResolve?.();
    }
  }

  /**
   * Per-session SSE stream for real-time token streaming.
   * Subscribes to the global event stream and filters by this session's ID.
   * Retries with exponential backoff when the stream closes.
   *
   * TODO(step-5): DELETE this method when harness Effect loop is proven stable.
   * The consumer (_startConsumer) replaces this path entirely.
   */
  private async startEventStream(): Promise<void> {
    let delayMs = 500;
    const MAX_DELAY_MS = 30_000;

    while (!this.closed && !this.sseStopped) {
      try {
        const result = await this.client.event.subscribe({ query: { directory: this.cwd } });
        console.log(`[opencode-session] SSE stream connected for session ${this.opencodeSessionId}`);
        let receivedEvents = false;
        for await (const event of result.stream) {
          if (this.closed || this.sseStopped) break;
          const sid = this._extractSessionId(event);
          if (sid !== this.opencodeSessionId) continue; // filter to this session only
          receivedEvents = true;
          // Push to buffer — consumer will dispatch to listeners.
          // TODO(step-5): remove call to _receiveEvent when startEventStream() is deleted.
          this._receiveEvent(event);
          this._sseEventCount++;
          this._sseDeliveredForCurrentPrompt = true;
          console.log(`[opencode-session] SSE event received: type=${event.type} session=${this.opencodeSessionId} (total: ${this._sseEventCount})`);
          // Unblock prompt() if session.idle just arrived.
          // TODO(step-5): remove direct _idleResolve call when startEventStream() is deleted.
          if (event.type === 'session.idle') {
            this._idleResolve?.();
          }
        }
        console.log(`[opencode-session] SSE stream ended for session ${this.opencodeSessionId} (received ${receivedEvents ? 'events' : 'no events'})`);
        if (receivedEvents) delayMs = 500; // reset backoff after healthy stream
      } catch {
        // ignore errors, retry below
      }
      if (this.closed || this.sseStopped) break;
      await this._sseDelay(delayMs);
      delayMs = Math.min(delayMs * 2, MAX_DELAY_MS);
    }
    this.sseRunning = false;
  }

  /** Extract the opencode sessionID from a raw SSE event. */
  private _extractSessionId(event: SdkEvent): string | undefined {
    const p = event.properties;
    if ('sessionID' in p && typeof p.sessionID === 'string') return p.sessionID;
    if ('part' in p && p.part && typeof p.part === 'object' && 'sessionID' in p.part) {
      return (p.part as Part).sessionID;
    }
    return undefined;
  }

  /** Sleep for `ms` milliseconds, resolving early if the session is closed. */
  private _sseDelay(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => { clearInterval(poll); resolve(); }, ms);
      const poll = setInterval(() => {
        if (this.closed || this.sseStopped) { clearTimeout(timer); clearInterval(poll); resolve(); }
      }, 50);
    });
  }
}

function isHttpError(err: unknown, statusCode: number): boolean {
  return !!(err && typeof err === 'object' && 'status' in err && (err as { status: number }).status === statusCode);
}
