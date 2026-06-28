import { randomUUID } from 'node:crypto';

import type { SDKAgent, SDKMessage } from '@cursor/sdk';

import type {
  DirectHarnessSession,
  DirectHarnessSessionEvent,
  PromptInput,
} from '../../../domain/direct-harness/entities/direct-harness-session.js';
import type { OpenCodeSessionId } from '../../../domain/direct-harness/entities/harness-session.js';
import { resolveCursorSdkModel } from '../../services/remote-agents/cursor-sdk/cursor-models.js';
import { withTimeout } from '../../services/remote-agents/with-timeout.js';

const SEND_TIMEOUT_MS = 60_000;
const RUN_WAIT_TIMEOUT_MS = 3_600_000;

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
        if (message.text) {
          this.emitDelta(messageId, message.text, 'reasoning');
        }
        break;
      default:
        break;
    }
  }
}

function resolveModelFromPrompt(providerID: string, modelID: string): string {
  if (providerID === 'cursor') return resolveCursorSdkModel(modelID);
  return resolveCursorSdkModel(`${providerID}/${modelID}`);
}
