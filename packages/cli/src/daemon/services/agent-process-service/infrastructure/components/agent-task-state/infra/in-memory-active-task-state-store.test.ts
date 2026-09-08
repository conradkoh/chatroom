import { describe, expect, test } from 'vitest';

import { InMemoryActiveTaskStateStore } from './in-memory-active-task-state-store.js';

const key = { chatroomId: 'room_1', role: 'Builder' };

describe('InMemoryActiveTaskStateStore', () => {
  test('tracks active task identity', () => {
    const store = new InMemoryActiveTaskStateStore();
    store.start({ ...key, taskId: 'task_1' });

    expect(store.get(key)).toMatchObject({
      taskId: 'task_1',
    });
  });

  test('replaces the active task for a role', () => {
    const store = new InMemoryActiveTaskStateStore();

    store.start({ ...key, taskId: 'task_1' });
    const replacement = store.start({ ...key, taskId: 'task_2' });

    expect(replacement).toEqual({ chatroomId: 'room_1', role: 'Builder', taskId: 'task_2' });
    expect(store.get(key)).toEqual(replacement);
  });

  test('clears one key or all state', () => {
    const store = new InMemoryActiveTaskStateStore();
    store.start({ ...key, taskId: 'task_1' });
    store.start({ chatroomId: 'room_2', role: 'builder', taskId: 'task_2' });

    expect(store.clear(key)).toBe(true);
    expect(store.clearAll()).toBe(1);
    expect(store.clearAll()).toBe(0);
  });
});
