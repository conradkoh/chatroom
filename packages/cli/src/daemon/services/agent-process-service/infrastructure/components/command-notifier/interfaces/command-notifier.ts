import type {
  CommandNotification,
  CommandNotificationFilter,
} from '../entities/command-notification.js';

export type CommandNotificationListener<T> = (
  event: CommandNotification<T>
) => void | Promise<void>;
export type CommandNotificationErrorHandler = (error: unknown) => void;

export interface CommandNotifier<T = unknown> {
  publish(event: CommandNotification<T>): void;
  subscribe(
    filter: CommandNotificationFilter,
    listener: CommandNotificationListener<T>
  ): () => void;
}

export interface InMemoryCommandNotifierOptions {
  onListenerError?: CommandNotificationErrorHandler;
}
