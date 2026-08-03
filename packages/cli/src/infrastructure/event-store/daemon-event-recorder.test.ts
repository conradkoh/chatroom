import { describe, expect, test, vi } from 'vitest';

import { DaemonEventRecorder } from './daemon-event-recorder';
import type { EventStore, StoredEvent } from './types';

function makeStore(overrides: Partial<EventStore> = {}): EventStore {
  const events: StoredEvent[] = [];
  return {
    append: (input) => {
      events.push({ id: 'evt-1', ...input });
      return 'evt-1';
    },
    listByChatroom: () => ({ page: events, continueCursor: null, isDone: true }),
    close: () => {},
    ...overrides,
  };
}

describe('DaemonEventRecorder', () => {
  test('appends locally then calls publish', async () => {
    const store = makeStore();
    const appendSpy = vi.spyOn(store, 'append');
    const recorder = new DaemonEventRecorder(store, 'machine-1');

    const result = await recorder.appendAndPublish(
      {
        chatroomId: 'room-1',
        type: 'agent.started',
        timestamp: 1234,
        payload: { role: 'builder', pid: 42 },
      },
      async () => 'published'
    );

    expect(result).toBe('published');
    expect(appendSpy).toHaveBeenCalledWith({
      chatroomId: 'room-1',
      machineId: 'machine-1',
      type: 'agent.started',
      timestamp: 1234,
      payload: JSON.stringify({ role: 'builder', pid: 42 }),
    });
  });

  test('local append failure still publishes', async () => {
    const store = makeStore({
      append: () => {
        throw new Error('disk full');
      },
    });
    const recorder = new DaemonEventRecorder(store, 'machine-1');
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await recorder.appendAndPublish(
      { chatroomId: 'room-1', type: 'agent.exited', timestamp: 1, payload: { role: 'builder' } },
      async () => 'published'
    );

    expect(result).toBe('published');
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
