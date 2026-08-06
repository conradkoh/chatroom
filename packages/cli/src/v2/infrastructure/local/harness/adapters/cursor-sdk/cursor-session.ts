import { randomUUID } from 'node:crypto';

import type { InteractionUpdate, SDKAgent, SDKMessage } from '@cursor/sdk';

import { resolveCursorSdkModel } from '../../../../../../infrastructure/services/remote-agents/cursor-sdk/cursor-models.js';
import {
  logUnhandledInteractionDelta,
  logUnhandledSdkMessage,
} from '../../../../../../infrastructure/services/remote-agents/cursor-sdk/cursor-sdk-stream-fallback.js';
import { withTimeout } from '../../../../../../infrastructure/services/remote-agents/with-timeout.js';
import type {
  DirectHarnessSession,
  DirectHarnessSessionEvent,
  PromptInput,
} from '../../../../../domain/entities/direct-harness-session.js';
import type { OpenCodeSessionId } from '../../../../../domain/entities/harness-session.js';

const SEND_TIMEOUT_MS = 60_000;
const RUN_WAIT_TIMEOUT_MS = 3_600_000;

const HARNESS_LOG_PREFIX = '[cursor-sdk-harness';

// The harness surfaces agent output via typed events, not stdout log lines, so
// fallback logging for unhandled protocol events goes to console.warn.
function warnWriteLine(line: string): void {
  console.warn(line);
}

export interface CursorSdkSessionOptions {
  readonly agent: SDKAgent;
  readonly opencodeSessionId: string;
  readonly sessionTitle: string;
  readonly onClose?: (sessionId: string) => void;
}

export class CursorSdkSession implements DirectHarnessSession {
  readonly opencodeSessionId: OpenCodeSessionId;
  private _sessionTitle: string;
  get sessionTitle(): string {
    return this._sessionTitle;
  }

  private readonly agent: SDKAgent;
  private readonly onClose?: (sessionId: string) => void;
  private readonly listeners = new Set<(event: DirectHarnessSessionEvent) => void>();
  private closed = false;
  private turnCount = 0;

  constructor(options: CursorSdkSessionOptions) {
    this.agent = options.agent;
    this.opencodeSessionId = options.opencodeSessionId as OpenCodeSessionId;
    this._sessionTitle = options.sessionTitle;
    this.onClose = options.onClose;
  }

  setTitle(title: string): void {
    this._sessionTitle = title;
  }

  // fallow-ignore-next-line complexity
  async prompt(input: PromptInput): Promise<void> {
    if (this.closed) throw new Error('Session is closed');

    const text = input.parts.map((p) => p.text).join('\n');
    const messageId = randomUUID();
    const isFirstTurn = this.turnCount === 0;
    this.turnCount += 1;

    const modelId = input.model
      ? resolveModelFromPrompt(input.model.providerID, input.model.modelID)
      : undefined;

    const run = await withTimeout(
      this.agent.send(text, {
        local: { force: isFirstTurn },
        idempotencyKey: randomUUID(),
        ...(modelId ? { model: { id: modelId } } : {}),
        onDelta: ({ update }) => {
          this.handleInteractionDelta(messageId, update);
        },
      }),
      SEND_TIMEOUT_MS,
      'agent.send'
    );

    for await (const message of run.stream()) {
      if (this.closed) break;
      this.emitFromSdkMessage(message, messageId);
    }

    const result = await withTimeout(run.wait(), RUN_WAIT_TIMEOUT_MS, 'run.wait');
    if (result.status === 'error') {
      const detail =
        typeof result.result === 'string' && result.result.trim().length > 0
          ? result.result.trim()
          : `run ${result.id} failed`;
      throw new Error(detail);
    }

    this.emit({ type: 'session.idle', payload: {}, timestamp: Date.now() });
  }

  onEvent(listener: (event: DirectHarnessSessionEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      this.agent.close();
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

  /**
   * Stream InteractionUpdate deltas delivered via SendOptions.onDelta into the
   * same message.part.delta events as run.stream() SDKMessages. Known non-text
   * deltas (token accounting, tool lifecycle, step/turn transitions) are
   * expected protocol traffic and ignored; unknown deltas are logged (not
   * thrown) so prompt() continues regardless of SDK additions.
   */
  // fallow-ignore-next-line complexity
  private handleInteractionDelta(messageId: string, update: InteractionUpdate): void {
    switch (update.type) {
      case 'text-delta':
        this.emitDelta(messageId, update.text, 'text');
        break;
      case 'thinking-delta':
        this.emitDelta(messageId, update.text, 'reasoning');
        break;
      case 'tool-call-delta':
        if (update.taskUpdate.type === 'text-delta') {
          this.emitDelta(messageId, update.taskUpdate.text, 'text');
        }
        break;
      case 'token-delta':
      case 'tool-call-started':
      case 'tool-call-completed':
      case 'turn-ended':
      case 'thinking-completed':
      case 'summary-started':
      case 'summary-completed':
      case 'summary':
      case 'user-message-appended':
      case 'partial-tool-call':
      case 'shell-output-delta':
      case 'step-started':
      case 'step-completed':
        // Expected protocol deltas — not agent output for the direct harness.
        break;
      default:
        logUnhandledInteractionDelta(HARNESS_LOG_PREFIX, update, warnWriteLine);
        break;
    }
  }

  // fallow-ignore-next-line complexity
  private emitFromSdkMessage(message: SDKMessage, messageId: string): void {
    switch (message.type) {
      case 'assistant':
        for (const block of message.message.content) {
          if (block.type === 'text' && block.text) {
            this.emitDelta(messageId, block.text, 'text');
          }
        }
        break;
      case 'thinking':
        // Handled via thinking-delta in onDelta — SDKMessage duplicates content.
        break;
      case 'status':
      case 'system':
      case 'task':
      case 'tool_call':
      case 'usage':
      case 'user':
      case 'request':
        // Expected protocol messages — not agent output for the direct harness.
        break;
      default:
        logUnhandledSdkMessage(HARNESS_LOG_PREFIX, message, warnWriteLine);
        break;
    }
  }
}

function resolveModelFromPrompt(providerID: string, modelID: string): string {
  if (providerID === 'cursor') return resolveCursorSdkModel(modelID);
  return resolveCursorSdkModel(`${providerID}/${modelID}`);
}
