/**
 * OpencodeSdkSession — DirectHarnessSession backed by @opencode-ai/sdk client.
 *
 * Lifecycle:
 *   1. Constructor receives an OpencodeClient + harness session ID.
 *   2. onEvent() subscribes to the global SSE event stream, filters by
 *      sessionID, and broadcasts relevant events as DirectHarnessSessionEvents.
 *   3. prompt() sends a structured prompt via session.prompt().
 *   4. close() aborts the session and cleans up the event subscription.
 *
 * Streaming: the SDK's prompt() is synchronous (blocks until the message is
 * complete), but events arrive in real-time via the SSE subscription. Text
 * deltas arrive as message.part.updated events with a "delta" field.
 */

import { createOpencodeClient } from '@opencode-ai/sdk';
import type { OpencodeClient } from '@opencode-ai/sdk';
import type { DirectHarnessSession, DirectHarnessSessionEvent, PromptInput } from '../../../domain/direct-harness/entities/direct-harness-session.js';
import type { HarnessSessionId } from '../../../domain/direct-harness/entities/harness-session.js';

// ─── Types ───────────────────────────────────────────────────────────────────

/** Shape of a raw opencode SSE event from the event subscription. */
interface OpenCodeEvent {
  type: string;
  properties?: Record<string, unknown>;
}

/** Return type of client.event.subscribe(). */
interface EventStream {
  stream: AsyncGenerator<OpenCodeEvent>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Extract sessionID from an event's properties if present. */
function eventSessionId(event: OpenCodeEvent): string | undefined {
  const p = event.properties;
  if (!p || typeof p !== 'object') return undefined;
  if ('sessionID' in p && typeof p.sessionID === 'string') return p.sessionID;
  return undefined;
}

/** Build a DirectHarnessSessionEvent from an opencode event. */
function toSessionEvent(event: OpenCodeEvent): DirectHarnessSessionEvent {
  const payload = event.properties ?? {};
  return {
    type: event.type,
    payload,
    timestamp: Date.now(),
  };
}

// ─── Options ─────────────────────────────────────────────────────────────────

export interface OpencodeSdkSessionOptions {
  /** Base URL of the opencode server (e.g. http://127.0.0.1:15432). */
  readonly baseUrl: string;
  /** The harness-issued session ID. */
  readonly harnessSessionId: string;
  /** Human-readable session title. */
  readonly sessionTitle: string;
}

// ─── Implementation ──────────────────────────────────────────────────────────

export class OpencodeSdkSession implements DirectHarnessSession {
  readonly harnessSessionId: HarnessSessionId;
  readonly sessionTitle: string;

  private readonly client: OpencodeClient;
  private readonly onEventListeners = new Set<(event: DirectHarnessSessionEvent) => void>();
  private eventStream: EventStream | null = null;
  private eventStreamPromise: Promise<void> | null = null;
  private closed = false;

  constructor(options: OpencodeSdkSessionOptions) {
    this.harnessSessionId = options.harnessSessionId as HarnessSessionId;
    this.sessionTitle = options.sessionTitle;
    this.client = createOpencodeClient({ baseUrl: options.baseUrl });
  }

  /** Send a structured prompt to the running harness session. */
  async prompt(input: PromptInput): Promise<void> {
    if (this.closed) throw new Error('Session is closed');

    await this.client.session.prompt({
      path: { id: this.harnessSessionId },
      body: {
        agent: input.agent,
        parts: input.parts.map((p) => ({
          type: 'text' as const,
          text: p.text,
        })),
        ...(input.model ? { model: input.model } : {}),
        ...(input.system ? { system: input.system } : {}),
        ...(input.tools ? { tools: input.tools } : {}),
      },
    });
  }

  /** Subscribe to harness session events. Returns an unsubscribe function. */
  onEvent(listener: (event: DirectHarnessSessionEvent) => void): () => void {
    this.onEventListeners.add(listener);

    // Lazily start the event stream on first subscription
    if (!this.eventStreamPromise) {
      this.eventStreamPromise = this.startEventStream();
    }

    return () => {
      this.onEventListeners.delete(listener);
    };
  }

  /** Close the session cleanly. */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    // Abort the opencode session
    try {
      await this.client.session.abort({ path: { id: this.harnessSessionId } });
    } catch (err) {
      // 404 means the session is already gone — fine
      if (isHttpError(err, 404)) {
        // Session already cleaned up by the harness
      } else {
        throw err;
      }
    }

    // Clear listeners
    this.onEventListeners.clear();
    this.eventStream = null;
    this.eventStreamPromise = null;
  }

  /** Update the session title (called when the harness reports a rename). */
  setTitle(title: string): void {
    (this as { sessionTitle: string }).sessionTitle = title;
  }

  /** Internal: emit an event to all subscribed listeners. */
  _emit(event: DirectHarnessSessionEvent): void {
    for (const listener of this.onEventListeners) {
      listener(event);
    }
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  /**
   * Subscribe to the global SSE event stream and dispatch events that belong
   * to this session. Runs until the stream ends or the session is closed.
   */
  private async startEventStream(): Promise<void> {
    // Already started or closed
    if (this.eventStream) return;

    try {
      const stream = await this.client.event.subscribe();
      this.eventStream = stream as unknown as EventStream;

      for await (const event of this.eventStream.stream) {
        if (this.closed) break;

        // Only forward events for this session
        if (eventSessionId(event) !== this.harnessSessionId) continue;

        const sessionEvent = toSessionEvent(event);
        this._emit(sessionEvent);
      }
    } catch (err) {
      // If we're closed, silence errors from the event loop
      if (this.closed) return;
      throw err;
    }
  }
}

// ─── Internal helpers ────────────────────────────────────────────────────────

function isHttpError(err: unknown, statusCode: number): boolean {
  if (err && typeof err === 'object' && 'status' in err) {
    return (err as { status: number }).status === statusCode;
  }
  return false;
}
