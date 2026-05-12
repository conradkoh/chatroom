import type { OpencodeClient, Event as SdkEvent, Part } from '@opencode-ai/sdk';
import type { DirectHarnessSession, DirectHarnessSessionEvent, PromptInput } from '../../../domain/direct-harness/entities/direct-harness-session.js';
import type { OpenCodeSessionId } from '../../../domain/direct-harness/entities/harness-session.js';

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

  get sseDeliveredForCurrentPrompt(): boolean { return this._sseDeliveredForCurrentPrompt; }

  constructor(options: OpencodeSdkSessionOptions) {
    this.options = options;
    this.opencodeSessionId = options.opencodeSessionId as OpenCodeSessionId;
    this._sessionTitle = options.sessionTitle;
    this.client = options.client;
    this.cwd = options.cwd;
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
    // Start per-session SSE stream on first subscriber
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

  /** Dispatch an event received from the harness-level SSE fan-out loop. */
  _receiveEvent(raw: SdkEvent): void {
    this._emit(toSessionEvent(raw));
  }

  _emit(event: DirectHarnessSessionEvent): void {
    for (const listener of this.onEventListeners) listener(event);
  }

  /**
   * Per-session SSE stream for real-time token streaming.
   * Subscribes to the global event stream and filters by this session's ID.
   * Retries with exponential backoff when the stream closes.
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
          this._receiveEvent(event);
          this._sseEventCount++;
          this._sseDeliveredForCurrentPrompt = true;
          console.log(`[opencode-session] SSE event received: type=${event.type} session=${this.opencodeSessionId} (total: ${this._sseEventCount})`);
          // Unblock prompt() if session.idle just arrived
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
