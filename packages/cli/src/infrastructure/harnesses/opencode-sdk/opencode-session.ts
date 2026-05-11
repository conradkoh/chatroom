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
  private readonly onEventListeners = new Set<(event: DirectHarnessSessionEvent) => void>();
  private closed = false;

  constructor(options: OpencodeSdkSessionOptions) {
    this.options = options;
    this.opencodeSessionId = options.opencodeSessionId as OpenCodeSessionId;
    this.sessionTitle = options.sessionTitle;
    this.client = options.client;
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
    // Event delivery is managed by the parent harness's SSE fan-out loop.
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
}

function isHttpError(err: unknown, statusCode: number): boolean {
  return !!(err && typeof err === 'object' && 'status' in err && (err as { status: number }).status === statusCode);
}
