import { describe, expect, test } from 'vitest';

import { InMemoryActiveTaskStateStore } from './in-memory-active-task-state-store.js';

const key = { chatroomId: 'room_1', role: 'Builder' };
const version = { taskId: 'task_1', generation: 1 };

describe('InMemoryActiveTaskStateStore', () => {
  test('tracks task identity and handoff state', () => {
    const store = new InMemoryActiveTaskStateStore();
    store.start({ ...key, taskId: version.taskId });

    expect(store.get(key)).toMatchObject({
      taskId: 'task_1',
      generation: 1,
      status: 'in_flight',
      handedOff: false,
      reminderAttempts: 0,
    });

    expect(store.markHandedOff(key, version)).toBe(true);
    expect(store.get(key)).toMatchObject({ status: 'handed_off', handedOff: true });
  });

  test('rejects stale task transitions', () => {
    const store = new InMemoryActiveTaskStateStore();
    store.start({ ...key, taskId: version.taskId });

    expect(store.markHandedOff(key, { taskId: 'task_old', generation: 1 })).toBe(false);
    expect(store.complete(key, { taskId: 'task_1', generation: 2 })).toBe(false);
    expect(store.get(key)?.handedOff).toBe(false);
  });

  test('advances the generation when a new task replaces the active task', () => {
    const store = new InMemoryActiveTaskStateStore();

    store.start({ ...key, taskId: 'task_1' });
    const replacement = store.start({ ...key, taskId: 'task_2' });

    expect(replacement).toMatchObject({ taskId: 'task_2', generation: 2 });
    expect(store.markHandedOff(key, { taskId: 'task_1', generation: 1 })).toBe(false);
    expect(store.markHandedOff(key, { taskId: 'task_2', generation: 2 })).toBe(true);
  });

  test('records one turn-end event and deduplicates it', () => {
    const store = new InMemoryActiveTaskStateStore();
    store.start({ ...key, taskId: version.taskId });

    expect(store.recordTurnEnd(key, version, 'event_1')).toMatchObject({
      status: 'reminder_requested',
      reminderAttempts: 1,
      lastTurnEndEventId: 'event_1',
    });
    expect(store.recordTurnEnd(key, version, 'event_1')).toBeUndefined();
    expect(store.recordTurnEnd(key, version, 'event_2')).toMatchObject({
      reminderAttempts: 2,
    });
  });

  test('clears one key or all state', () => {
    const store = new InMemoryActiveTaskStateStore();
    store.start({ ...key, taskId: version.taskId });
    store.start({ chatroomId: 'room_2', role: 'builder', taskId: 'task_2' });

    expect(store.clear(key)).toBe(true);
    expect(store.clearAll()).toBe(1);
    expect(store.clearAll()).toBe(0);
  });
});
