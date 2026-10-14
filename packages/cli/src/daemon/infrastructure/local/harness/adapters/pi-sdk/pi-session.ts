import { randomUUID } from 'node:crypto';

import type { AgentSession, AgentSessionEvent } from '@earendil-works/pi-coding-agent';

import type {
  DirectHarnessSession,
  DirectHarnessSessionEvent,
  PromptInput,
} from '../../../../../domain/entities/direct-harness-session.js';
import type { OpenCodeSessionId } from '../../../../../domain/entities/harness-session.js';
import { assistantErrorOf } from '../../services/pi-sdk/assistant-error.js';
import { withTimeout } from '../../services/with-timeout.js';

const PROMPT_TIMEOUT_MS = 3_600_000;

export interface PiSdkSessionOptions {
  readonly session: AgentSession;
  readonly opencodeSessionId: string;
  readonly sessionTitle: string;
  readonly onClose?: ((sessionId: string) => void) | undefined;
}

export class PiSdkSession implements DirectHarnessSession {
  readonly opencodeSessionId: OpenCodeSessionId;
  private _sessionTitle: string;
  get sessionTitle(): string {
    return this._sessionTitle;
  }

  private readonly session: AgentSession;
  private readonly onClose?: ((sessionId: string) => void) | undefined;
  private readonly listeners = new Set<(event: DirectHarnessSessionEvent) => void>();
  private closed = false;
  private unsubscribe?: (() => void) | undefined;
  /** Provider error of the latest assistant message in the current prompt, or undefined when it succeeded. */
  private lastAssistantError: string | undefined;

  constructor(options: PiSdkSessionOptions) {
    this.session = options.session;
    this.opencodeSessionId = options.opencodeSessionId as OpenCodeSessionId;
    this._sessionTitle = options.sessionTitle;
    this.onClose = options.onClose;
  }

  setTitle(title: string): void {
    this._sessionTitle = title;
  }

  async prompt(input: PromptInput): Promise<void> {
    if (this.closed) throw new Error('Session is closed');

    const text = input.parts.map((p) => p.text).join('\n');
    const messageId = randomUUID();

    this.lastAssistantError = undefined;
    const onSessionEvent = (event: AgentSessionEvent) => {
      if (this.closed) return;
      if (event.type === 'message_end' && event.message.role === 'assistant') {
        // A retried error that later succeeds clears here, so only the final outcome counts.
        this.lastAssistantError = assistantErrorOf(event);
      }
      this.emitFromPiEvent(event, messageId);
    };

    this.unsubscribe?.();
    this.unsubscribe = this.session.subscribe(onSessionEvent);

    await withTimeout(this.session.prompt(text), PROMPT_TIMEOUT_MS, 'session.prompt');

    // Direct-session convention: a provider failure rejects prompt() and emits no session.idle.
    if (this.lastAssistantError !== undefined) {
      throw new Error(this.lastAssistantError);
    }
    this.emit({ type: 'session.idle', payload: {}, timestamp: Date.now() });
  }

  onEvent(listener: (event: DirectHarnessSessionEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  // fallow-ignore-next-line complexity
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.unsubscribe?.();
    try {
      await this.session.abort();
    } catch {
      // Best-effort
    }
    try {
      this.session.dispose();
    } catch {
      // Best-effort
    }
    this.onClose?.(this.opencodeSessionId);
    this.listeners.clear();
  }

  private emit(event: DirectHarnessSessionEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  private emitDelta(messageId: string, delta: string, partType: 'text' | 'reasoning'): void {
    if (!delta) return;
    this.emit({
      type: 'message.part.delta',
      payload: { messageID: messageId, delta, partType },
      timestamp: Date.now(),
    });
  }

  private emitFromPiEvent(event: AgentSessionEvent, messageId: string): void {
    if (event.type !== 'message_update') return;
    const assistantEvent = event.assistantMessageEvent;
    if (assistantEvent.type === 'text_delta') {
      this.emitDelta(messageId, assistantEvent.delta, 'text');
    } else if (assistantEvent.type === 'thinking_delta') {
      this.emitDelta(messageId, assistantEvent.delta, 'reasoning');
    }
  }
}
