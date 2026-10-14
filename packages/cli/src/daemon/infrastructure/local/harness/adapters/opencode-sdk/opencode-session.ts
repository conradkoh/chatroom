import type { OpenCodeClient, OpenCodeEvent } from '@opencode/client';

import { SseEventBuffer } from './sse-event-buffer.js';
import type {
  DirectHarnessSession,
  DirectHarnessSessionEvent,
  PromptInput,
} from '../../../../../domain/entities/direct-harness-session.js';
import type { OpenCodeSessionId } from '../../../../../domain/entities/harness-session.js';
import { parseOpencodeSpawnModel } from '../../services/opencode-sdk/pure.js';

/** Key used for the chatroom role overlay in the session instruction entries. */
const CHATROOM_INSTRUCTION_KEY = 'chatroom-role';

function toSessionEvent(event: OpenCodeEvent): DirectHarnessSessionEvent {
  return { type: event.type, payload: event.data ?? {}, timestamp: Date.now() };
}

/** Human-readable message for a failed execution, from the V2 structured error payload. */
function executionFailureMessage(error: { type?: string; message?: string } | undefined): string {
  return error?.message || error?.type || 'Session execution failed';
}

/**
 * Error that rejects the in-flight turn for a failed or interrupted execution.
 * Returns null for every other event, which does not reject a turn.
 */
function turnRejectionFor(raw: OpenCodeEvent): Error | null {
  switch (raw.type) {
    case 'session.execution.failed':
      return new Error(executionFailureMessage(raw.data.error));
    case 'session.execution.interrupted': {
      const reason = raw.data.reason ? `: ${raw.data.reason}` : '';
      return new Error(`Session execution was interrupted${reason}`);
    }
    default:
      return null;
  }
}

export interface OpencodeSdkSessionOptions {
  /** The shared HTTP client from the parent harness. */
  readonly client: OpenCodeClient;
  readonly opencodeSessionId: string;
  readonly sessionTitle: string;
  /** The working directory for the harness. */
  readonly cwd: string;
  /**
   * Called when the session is closed so the parent harness can unregister
   * the session from its SSE fan-out map.
   */
  readonly onClose?: ((opencodeSessionId: string) => void) | undefined;
}

export class OpencodeSdkSession implements DirectHarnessSession {
  readonly opencodeSessionId: OpenCodeSessionId;
  /** Backing field for sessionTitle to allow mutation via setTitle(). */
  private _sessionTitle: string;
  get sessionTitle(): string {
    return this._sessionTitle;
  }

  private readonly client: OpenCodeClient;
  private readonly options: OpencodeSdkSessionOptions;
  private readonly onEventListeners = new Set<(event: DirectHarnessSessionEvent) => void>();
  private closed = false;
  /** Resolve callback to unblock prompt() when the turn's execution succeeds (or the session goes idle). */
  private _turnDoneResolve: (() => void) | null = null;
  /** Reject callback to fail prompt() when the turn's execution fails or is interrupted. */
  private _turnDoneReject: ((err: Error) => void) | null = null;

  // ── Buffer consumer ───────────────────────────────────────────────────────────
  /** Per-session event buffer — harness fan-out pushes raw SDK events; consumer drains them. */
  private readonly _buffer: SseEventBuffer<OpenCodeEvent>;
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
    this._buffer = new SseEventBuffer<OpenCodeEvent>();
  }

  async prompt(input: PromptInput): Promise<void> {
    if (this.closed) throw new Error('Session is closed');
    // Create a promise that settles when the turn's execution finishes.
    // In OpenCode V2 a user prompt runs as one "execution" and the server emits
    // session.execution.succeeded, .failed or .interrupted when it completes.
    const turnPromise = new Promise<void>((resolve, reject) => {
      this._turnDoneResolve = resolve;
      this._turnDoneReject = reject;
    });
    // A terminal failure can land while we are still awaiting the submission below.
    // Mark the promise handled so that early rejection is not reported as unhandled;
    // the rejection is still observed by the Promise.race below.
    turnPromise.catch(() => {});

    const TURN_TIMEOUT_MS = 300_000; // 5 minutes
    // The timeout timer is created only right before the wait and cleared in `finally`,
    // so it never outlives the turn: no late unhandled rejection, no event-loop hold.
    let timer: ReturnType<typeof setTimeout> | undefined;

    try {
      // V2 moved agent/model off the prompt body: select them on the session first.
      // The system overlay is delivered as a session instruction entry, which
      // OpenCode appends after the agent's own system prompt.
      await this._applyPromptOverrides(input);

      // Submit the prompt; content streams via SSE.
      const text = input.parts.map((p) => p.text).join('');
      await this.client.session.prompt({
        sessionID: this.opencodeSessionId,
        text,
      });

      console.log(
        `[opencode-session] prompt submitted for session ${this.opencodeSessionId}, waiting for execution to finish via SSE`
      );

      // Wait for the execution terminal event (delivered by the harness SSE fan-out) or timeout.
      // Rejects when the execution failed or was interrupted, so callers never treat it as success.
      const timeoutPromise = new Promise<void>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Timed out waiting for session execution to finish')),
          TURN_TIMEOUT_MS
        );
      });
      await Promise.race([turnPromise, timeoutPromise]);
      console.log(`[opencode-session] execution finished for session ${this.opencodeSessionId}`);
    } catch (err) {
      console.warn(
        `[opencode-session] ${err instanceof Error ? err.message : String(err)} — session ${this.opencodeSessionId}`
      );
      // A missing terminal event or a failed execution is not successful completion.
      throw err;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      // Never let a late terminal event settle a later turn.
      this._turnDoneResolve = null;
      this._turnDoneReject = null;
    }

    console.log(`[opencode-session] prompt() completed for session ${this.opencodeSessionId}`);
  }

  private async _applyPromptOverrides(input: PromptInput): Promise<void> {
    if (input.agent) {
      await this.client.session.switchAgent({
        sessionID: this.opencodeSessionId,
        agent: input.agent,
      });
    }
    if (input.model) {
      // Constraint: decode `[variant=…]` from modelID with the same helper the spawn path uses
      // (services/opencode-sdk/pure.ts), otherwise the variant is silently dropped.
      const parsed = parseOpencodeSpawnModel(input.model.modelID);
      await this.client.session.switchModel({
        sessionID: this.opencodeSessionId,
        model: {
          providerID: input.model.providerID,
          id: parsed.model,
          ...(parsed.variant ? { variant: parsed.variant } : {}),
        },
      });
    }
    if (input.system) {
      await this.client.session.instructions.entry.put({
        sessionID: this.opencodeSessionId,
        key: CHATROOM_INSTRUCTION_KEY,
        value: input.system,
      });
    }
    // `input.tools` has no V2 per-prompt equivalent. Tool restrictions are
    // expressed as session permissions at creation time (see the agent service).
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
    return () => {
      this.onEventListeners.delete(listener);
    };
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
      await this.client.session.interrupt({ sessionID: this.opencodeSessionId });
    } catch {
      // Session may already be gone; abort is best-effort.
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
  _receiveEvent(raw: OpenCodeEvent): void {
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
   * Also settles the in-flight prompt() on its terminal execution event (see _settleTurn).
   *
   * Runs until the buffer is closed (i.e., close() is called).
   * This is the sole event-delivery path — events arrive from the harness Effect fiber
   * via _receiveEvent(), are buffered, and drained here.
   */
  private async _startConsumer(): Promise<void> {
    for await (const raw of this._buffer) {
      const evt = toSessionEvent(raw);
      for (const l of this.onEventListeners) l(evt);
      this._settleTurn(raw);
    }
  }

  /**
   * Settle the in-flight prompt() from a terminal execution event.
   * succeeded / idle resolve; failed / interrupted reject so the failure reaches the caller.
   * Callbacks are cleared after settling so a later event cannot settle a later turn.
   */
  private _settleTurn(raw: OpenCodeEvent): void {
    if (raw.type === 'session.execution.succeeded' || raw.type === 'session.idle') {
      this._resolveTurn();
    } else {
      const rejection = turnRejectionFor(raw);
      if (!rejection) return;
      this._rejectTurn(rejection);
    }
    this._turnDoneResolve = null;
    this._turnDoneReject = null;
  }

  /** Resolves the in-flight prompt(), if one is pending. */
  private _resolveTurn(): void {
    this._turnDoneResolve?.();
  }

  /** Rejects the in-flight prompt() with the execution error, if one is pending. */
  private _rejectTurn(error: Error): void {
    this._turnDoneReject?.(error);
  }
}
