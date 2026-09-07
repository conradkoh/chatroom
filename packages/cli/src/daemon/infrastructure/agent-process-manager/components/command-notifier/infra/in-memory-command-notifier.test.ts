import { describe, expect, it, vi } from 'vitest';

import { InMemoryCommandNotifier } from './in-memory-command-notifier.js';
import type { CommandNotification } from '../entities/command-notification.js';

function event(overrides: Partial<CommandNotification> = {}): CommandNotification {
  return {
    eventId: 'event-1',
    messageId: 'message-1',
    messageGroupId: 'room-1:builder',
    body: { type: 'stop' },
    status: 'succeeded',
    completedAt: 1,
    receiveCount: 1,
    ...overrides,
  };
}

describe('InMemoryCommandNotifier', () => {
  it('publishes matching events and supports unsubscribe', () => {
    const notifier = new InMemoryCommandNotifier();
    const listener = vi.fn();
    const unsubscribe = notifier.subscribe({ messageId: 'message-1' }, listener);

    notifier.publish(event());
    notifier.publish(event({ messageId: 'message-2' }));
    unsubscribe();
    notifier.publish(event());

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(event());
  });

  it('isolates listener failures from other subscribers', () => {
    const onListenerError = vi.fn();
    const notifier = new InMemoryCommandNotifier({ onListenerError });
    const healthyListener = vi.fn();

    notifier.subscribe({}, () => {
      throw new Error('listener failed');
    });
    notifier.subscribe({}, healthyListener);

    notifier.publish(event());

    expect(onListenerError).toHaveBeenCalledOnce();
    expect(healthyListener).toHaveBeenCalledWith(event());
  });
});
