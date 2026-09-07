import type { ReceivedCommandMessage } from '../entities/command-message.js';
import type { CommandQueue, ReceiveCommandMessagesOptions } from '../interfaces/command-queue.js';
import type { CommandNotifier } from '../../command-notifier/index.js';

export interface CommandQueueConsumerDependencies<T> {
  queue: CommandQueue<T>;
  dispatch(message: ReceivedCommandMessage<T>): Promise<void>;
  notifier: CommandNotifier<T>;
  sleep?(milliseconds: number): Promise<void>;
  onError?(error: unknown, message?: ReceivedCommandMessage<T>): void;
}

export interface CommandQueueConsumerOptions extends ReceiveCommandMessagesOptions {
  pollIntervalMs?: number;
  visibilityRenewalIntervalMs?: number;
}
