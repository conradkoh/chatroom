import { type CommandQueueStore, type StoredCommandMessage } from './command-queue-store.js';
import type { CommandMessage } from '../../entities/command-message.js';

/** In-memory strategy for command-queue message storage. */
export class InMemoryCommandQueueStore<T> implements CommandQueueStore<T> {
  private readonly messages = new Map<string, StoredCommandMessage<T>>();

  append(message: CommandMessage<T>): void {
    this.messages.set(message.messageId, { message });
  }

  list(): StoredCommandMessage<T>[] {
    return [...this.messages.values()];
  }

  delete(messageId: string): boolean {
    return this.messages.delete(messageId);
  }

  update(messageId: string, patch: Partial<StoredCommandMessage<T>>): void {
    const existing = this.messages.get(messageId);
    if (!existing) return;
    this.messages.set(messageId, { ...existing, ...patch });
  }

  clear(): void {
    this.messages.clear();
  }
}
