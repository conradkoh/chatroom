import { createOpencodeClient } from '@opencode-ai/sdk';
import type { OpencodeClient } from '@opencode-ai/sdk';
import type { DirectHarnessSession, DirectHarnessSessionEvent, PromptInput } from '../../../domain/direct-harness/entities/direct-harness-session.js';
import type { OpenCodeSessionId } from '../../../domain/direct-harness/entities/harness-session.js';

interface OpenCodeEvent {
  type: string;
  properties?: Record<string, unknown>;
}

interface EventStream {
  stream: AsyncGenerator<OpenCodeEvent>;
}

/**
 * Extract the sessionID from any opencode event.
 * Most events have properties.sessionID directly.
 * message.part.updated has it at properties.part.sessionID.
 */
function eventSessionId(event: OpenCodeEvent): string | undefined {
  const p = event.properties;
  if (!p || typeof p !== 'object') return undefined;
  // Direct (most events)
  if ('sessionID' in p && typeof p.sessionID === 'string') return p.sessionID;
  // message.part.updated — sessionID is on the nested part
  const part = (p as Record<string, unknown>).part;
  if (part && typeof part === 'object' && 'sessionID' in part && typeof (part as Record<string, unknown>).sessionID === 'string') {
    return (part as Record<string, unknown>).sessionID as string;
  }
  return undefined;
}

function toSessionEvent(event: OpenCodeEvent): DirectHarnessSessionEvent {
  return { type: event.type, payload: event.properties ?? {}, timestamp: Date.now() };
}

export interface OpencodeSdkSessionOptions {
  readonly baseUrl: string;
  readonly opencodeSessionId: string;
  readonly sessionTitle: string;
}

export class OpencodeSdkSession implements DirectHarnessSession {
  readonly opencodeSessionId: OpenCodeSessionId;
  readonly sessionTitle: string;

  private readonly client: OpencodeClient;
  private readonly onEventListeners = new Set<(event: DirectHarnessSessionEvent) => void>();
  private eventStream: EventStream | null = null;
  private eventStreamPromise: Promise<void> | null = null;
  private closed = false;

  constructor(options: OpencodeSdkSessionOptions) {
    this.opencodeSessionId = options.opencodeSessionId as OpenCodeSessionId;
    this.sessionTitle = options.sessionTitle;
    this.client = createOpencodeClient({ baseUrl: options.baseUrl });
  }

  async prompt(input: PromptInput): Promise<void> {
    if (this.closed) throw new Error('Session is closed');
    await this.client.session.prompt({
      path: { id: this.opencodeSessionId },
      body: {
        agent: input.agent,
        parts: input.parts.map((p) => ({ type: 'text' as const, text: p.text })),
        ...(input.model ? { model: input.model } : {}),
        ...(input.system ? { system: input.system } : {}),
        ...(input.tools ? { tools: input.tools } : {}),
      },
    });
  }

  onEvent(listener: (event: DirectHarnessSessionEvent) => void): () => void {
    this.onEventListeners.add(listener);
    if (!this.eventStreamPromise) {
      this.eventStreamPromise = this.startEventStream();
    }
    return () => { this.onEventListeners.delete(listener); };
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      await this.client.session.abort({ path: { id: this.opencodeSessionId } });
    } catch (err) {
      if (!isHttpError(err, 404)) throw err;
    }
    const streamPromise = this.eventStreamPromise;
    this.eventStreamPromise = null;
    this.eventStream = null;
    try { await streamPromise; } catch { /* silenced after close */ }
    this.onEventListeners.clear();
  }

  setTitle(title: string): void {
    (this as { sessionTitle: string }).sessionTitle = title;
  }

  _emit(event: DirectHarnessSessionEvent): void {
    for (const listener of this.onEventListeners) listener(event);
  }

  private async startEventStream(): Promise<void> {
    if (this.eventStream) return;
    try {
      const stream = await this.client.event.subscribe();
      this.eventStream = stream as unknown as EventStream;
      const iterator = this.eventStream.stream[Symbol.asyncIterator]();
      while (true) {
        let result: IteratorResult<unknown>;
        try { result = await iterator.next(); }
        catch (err) { if (this.closed) return; throw err; }
        if (result.done || this.closed) break;
        const event = result.value as OpenCodeEvent;
        if (eventSessionId(event) !== this.opencodeSessionId) continue;
        this._emit(toSessionEvent(event));
      }
    } catch (err) {
      if (this.closed) return;
      throw err;
    }
  }
}

function isHttpError(err: unknown, statusCode: number): boolean {
  return !!(err && typeof err === 'object' && 'status' in err && (err as { status: number }).status === statusCode);
}
