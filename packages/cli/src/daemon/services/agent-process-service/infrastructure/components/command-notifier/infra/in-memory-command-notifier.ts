import type {
  CommandNotification,
  CommandNotificationFilter,
} from '../entities/command-notification.js';
import type {
  CommandNotificationListener,
  CommandNotifier,
  InMemoryCommandNotifierOptions,
} from '../interfaces/command-notifier.js';

interface Subscription<T> {
  filter: CommandNotificationFilter;
  listener: CommandNotificationListener<T>;
}

function matchesFilter(event: CommandNotification, filter: CommandNotificationFilter): boolean {
  return (
    (filter.messageId === undefined || filter.messageId === event.messageId) &&
    (filter.messageGroupId === undefined || filter.messageGroupId === event.messageGroupId) &&
    (filter.status === undefined || filter.status === event.status)
  );
}

/**
 * In-process SNS-like notifier.
 *
 * Listener failures are isolated from publishers and other listeners. Events
 * are intentionally not retained; subscribers must be active when published.
 */
export class InMemoryCommandNotifier<T = unknown> implements CommandNotifier<T> {
  private readonly subscriptions = new Set<Subscription<T>>();

  constructor(private readonly options: InMemoryCommandNotifierOptions = {}) {}

  publish(event: CommandNotification<T>): void {
    for (const subscription of [...this.subscriptions]) {
      if (!matchesFilter(event, subscription.filter)) continue;

      try {
        void Promise.resolve(subscription.listener(event)).catch((error: unknown) => {
          this.options.onListenerError?.(error);
        });
      } catch (error) {
        this.options.onListenerError?.(error);
      }
    }
  }

  subscribe(
    filter: CommandNotificationFilter,
    listener: CommandNotificationListener<T>
  ): () => void {
    const subscription: Subscription<T> = { filter, listener };
    this.subscriptions.add(subscription);
    return () => this.subscriptions.delete(subscription);
  }
}
