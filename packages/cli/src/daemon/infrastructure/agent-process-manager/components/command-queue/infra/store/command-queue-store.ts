import type { CommandMessage } from '../../entities/command-message.js';

export interface StoredCommandMessage<T> {
  message: CommandMessage<T>;
  receiptHandle?: string | undefined;
  visibilityExpiresAt?: number | undefined;
}

/** Storage contract used by command-queue implementations. */
export interface CommandQueueStore<T> {
  append(message: CommandMessage<T>): void;
  list(): StoredCommandMessage<T>[];
  delete(messageId: string): boolean;
  update(messageId: string, patch: Partial<StoredCommandMessage<T>>): void;
  clear(): void;
}
