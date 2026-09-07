import type {
  CommandMessage,
  ReceivedCommandMessage,
  SentCommandMessage,
} from '../entities/command-message.js';
import type {
  CommandQueue,
  PurgeCommandMessagesInput,
  ReceiveCommandMessagesOptions,
  SendCommandMessageInput,
} from '../interfaces/command-queue.js';
import type { CommandQueueStore } from './store/command-queue-store.js';

const DEFAULT_VISIBILITY_TIMEOUT_MS = 30_000;

export interface InMemoryCommandQueueOptions<T> {
  store: CommandQueueStore<T>;
  now?: () => number;
  generateMessageId?: () => string;
  generateReceiptHandle?: () => string;
  deduplicationWindowMs?: number;
}

/** In-memory SQS-like FIFO command queue. */
export class InMemoryCommandQueue<T> implements CommandQueue<T> {
  private readonly now: () => number;
  private readonly generateMessageId: () => string;
  private readonly generateReceiptHandle: () => string;
  private readonly deduplicationWindowMs: number;
  private readonly deduplicated = new Map<string, SentCommandMessage & { expiresAt: number }>();
  private sequence = 0;

  constructor(private readonly options: InMemoryCommandQueueOptions<T>) {
    this.now = options.now ?? Date.now;
    this.generateMessageId = options.generateMessageId ?? (() => `command-${++this.sequence}`);
    this.generateReceiptHandle =
      options.generateReceiptHandle ?? (() => `receipt-${++this.sequence}`);
    this.deduplicationWindowMs = options.deduplicationWindowMs ?? 300_000;
  }

  async sendMessage(input: SendCommandMessageInput<T>): Promise<SentCommandMessage> {
    const now = this.now();
    if (input.deduplicationId) {
      const previous = this.deduplicated.get(input.deduplicationId);
      if (previous && previous.expiresAt > now) return previous;
      this.deduplicated.delete(input.deduplicationId);
    }

    const message: SentCommandMessage = {
      messageId: this.generateMessageId(),
      messageGroupId: input.messageGroupId,
      enqueuedAt: now,
    };
    this.options.store.append({
      ...message,
      body: input.body,
      receiveCount: 0,
    });

    if (input.deduplicationId) {
      this.deduplicated.set(input.deduplicationId, {
        ...message,
        expiresAt: now + this.deduplicationWindowMs,
      });
    }
    return message;
  }

  async receiveMessages(
    options: ReceiveCommandMessagesOptions = {}
  ): Promise<ReceivedCommandMessage<T>[]> {
    const now = this.now();
    const maxNumberOfMessages = Math.max(1, options.maxNumberOfMessages ?? 1);
    const visibilityTimeoutMs = Math.max(
      0,
      options.visibilityTimeoutMs ?? DEFAULT_VISIBILITY_TIMEOUT_MS
    );
    const claimedGroups = new Set<string>();
    const received: ReceivedCommandMessage<T>[] = [];
    const messages = this.options.store
      .list()
      .sort((a, b) => a.message.enqueuedAt - b.message.enqueuedAt);

    for (const stored of messages) {
      if (received.length >= maxNumberOfMessages) break;
      if (
        stored.receiptHandle &&
        stored.visibilityExpiresAt !== undefined &&
        stored.visibilityExpiresAt > now
      ) {
        continue;
      }
      if (stored.receiptHandle) {
        this.options.store.update(stored.message.messageId, {
          receiptHandle: undefined,
          visibilityExpiresAt: undefined,
        });
      }
      if (claimedGroups.has(stored.message.messageGroupId)) continue;

      const receiptHandle = this.generateReceiptHandle();
      const message = {
        ...stored.message,
        receiveCount: stored.message.receiveCount + 1,
      };
      const visibilityExpiresAt = now + visibilityTimeoutMs;
      this.options.store.update(stored.message.messageId, {
        message,
        receiptHandle,
        visibilityExpiresAt,
      });
      claimedGroups.add(message.messageGroupId);
      received.push({ ...message, receiptHandle, visibilityExpiresAt });
    }
    return received;
  }

  async deleteMessage(receiptHandle: string): Promise<void> {
    const stored = this.options.store
      .list()
      .find((candidate) => candidate.receiptHandle === receiptHandle);
    if (!stored) throw new Error(`Command receipt not found: ${receiptHandle}`);
    this.options.store.delete(stored.message.messageId);
  }

  async changeMessageVisibility(receiptHandle: string, visibilityTimeoutMs: number): Promise<void> {
    const stored = this.options.store
      .list()
      .find((candidate) => candidate.receiptHandle === receiptHandle);
    if (!stored) throw new Error(`Command receipt not found: ${receiptHandle}`);
    this.options.store.update(stored.message.messageId, {
      visibilityExpiresAt: this.now() + Math.max(0, visibilityTimeoutMs),
    });
  }

  async purge(input: PurgeCommandMessagesInput): Promise<CommandMessage<T>[]> {
    if (input.scope === 'all') {
      const messages = this.options.store.drain();
      this.deduplicated.clear();
      return messages;
    }

    const messages = this.options.store.drain((message) =>
      message.messageGroupId.startsWith(input.messageGroupPrefix)
    );
    for (const [deduplicationId, message] of this.deduplicated) {
      if (message.messageGroupId.startsWith(input.messageGroupPrefix)) {
        this.deduplicated.delete(deduplicationId);
      }
    }
    return messages;
  }
}
