import type { OpencodeClient } from '@opencode-ai/sdk';
import type { DirectHarnessSession, DirectHarnessSessionEvent, PromptInput } from '../../../domain/direct-harness/entities/direct-harness-session.js';
import type { OpenCodeSessionId } from '../../../domain/direct-harness/entities/harness-session.js';

function toSessionEvent(event: {
  type: string;
  properties?: Record<string, unknown>;
}): DirectHarnessSessionEvent {
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
  readonly sessionTitle: string;

  private readonly client: OpencodeClient;
  private readonly options: OpencodeSdkSessionOptions;
  private readonly cwd: string;
  private readonly onEventListeners = new Set<(event: DirectHarnessSessionEvent) => void>();
  private closed = false;
  /** True while the per-session SSE stream loop is running. */
  private sseRunning = false;
  /** Set to true to stop the SSE loop (session closed or no more listeners). */
  private sseStopped = false;

  constructor(options: OpencodeSdkSessionOptions) {
    this.options = options;
    this.opencodeSessionId = options.opencodeSessionId as OpenCodeSessionId;
    this.sessionTitle = options.sessionTitle;
    this.client = options.client;
    this.cwd = options.cwd;
  }

  async prompt(input: PromptInput): Promise<void> {
    if (this.closed) throw new Error('Session is closed');
    const response = await this.client.session.prompt({
      path: { id: this.opencodeSessionId },
      body: {
        agent: input.agent,
        parts: input.parts.map((p) => ({ type: 'text' as const, text: p.text })),
        ...(input.model ? { model: input.model } : {}),
        ...(input.system ? { system: input.system } : {}),
        ...(input.tools ? { tools: input.tools } : {}),
      },
    });

    // The HTTP response contains the full LLM response (synchronous completion).
    // Emit response parts as events so the existing chunk-extractor → journal → Convex
    // pipeline receives the content. This is the reliable path when SSE events
    // are not delivered (which is the common case with opencode's /event endpoint).
    const parts = (response as unknown as { data?: { parts?: unknown[] } }).data?.parts ?? [];
    for (const part of parts) {
      const p = part as { id?: string; messageID?: string; type?: string; text?: string };
      if ((p.type === 'text' || p.type === 'reasoning') && p.text && p.text.length > 0 && p.id && p.messageID) {
        this._emit({
          type: 'message.part.updated',
          payload: {
            part: { id: p.id, messageID: p.messageID, type: p.type },
            delta: p.text,
          },
          timestamp: Date.now(),
        });
      }
    }

    // Signal that the agent has finished generating.
    this._emit({ type: 'session.idle', payload: {}, timestamp: Date.now() });
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
    (this as { sessionTitle: string }).sessionTitle = title;
  }

  /** Dispatch an event received from the harness-level SSE fan-out loop. */
  _receiveEvent(raw: { type: string; properties?: Record<string, unknown> }): void {
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
        const result = await this.client.event.subscribe({ query: { directory: this.cwd } } as Parameters<typeof this.client.event.subscribe>[0]);
        const stream = (result as unknown as { stream: AsyncGenerator<unknown> }).stream;
        let receivedEvents = false;
        for await (const raw of stream) {
          if (this.closed || this.sseStopped) break;
          const event = raw as { type: string; properties?: Record<string, unknown> };
          const sid = this._extractSessionId(event);
          if (sid !== this.opencodeSessionId) continue; // filter to this session only
          receivedEvents = true;
          this._receiveEvent(event);
        }
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
  private _extractSessionId(event: { properties?: Record<string, unknown> }): string | undefined {
    const p = event.properties;
    if (!p) return undefined;
    if (typeof p.sessionID === 'string') return p.sessionID;
    const part = p.part as Record<string, unknown> | undefined;
    if (part && typeof part.sessionID === 'string') return part.sessionID;
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
