import { InMemoryCommandNotifier } from './infra/in-memory-command-notifier.js';
import type {
  CommandNotifier,
  InMemoryCommandNotifierOptions,
} from './interfaces/command-notifier.js';

/** Constructs the default in-memory command notifier. */
export function createCommandNotifier<T = unknown>(
  options: InMemoryCommandNotifierOptions = {}
): CommandNotifier<T> {
  return new InMemoryCommandNotifier<T>(options);
}

export { InMemoryCommandNotifier } from './infra/in-memory-command-notifier.js';
export type {
  CommandNotification,
  CommandNotificationFilter,
  CommandNotificationStatus,
} from './entities/command-notification.js';
export type {
  CommandNotificationErrorHandler,
  CommandNotificationListener,
  CommandNotifier,
  InMemoryCommandNotifierOptions,
} from './interfaces/command-notifier.js';
