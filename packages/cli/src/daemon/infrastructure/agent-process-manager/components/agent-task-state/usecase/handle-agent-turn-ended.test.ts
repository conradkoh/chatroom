import { describe, expect, test, vi } from 'vitest';

import { handleAgentTurnEnded } from './handle-agent-turn-ended.js';
import { InMemoryActiveTaskStateStore } from '../infra/in-memory-active-task-state-store.js';

const key = { chatroomId: 'room_1', role: 'builder' };
const version = { taskId: 'task_1', generation: 1 };

describe('handleAgentTurnEnded', () => {
  test('does nothing when there is no active task', async () => {
    const reminder = { remind: vi.fn() };
    const result = await handleAgentTurnEnded(
      { taskState: new InMemoryActiveTaskStateStore(), reminder },
      { ...key, version, eventId: 'event_1' }
    );

    expect(result).toEqual({ outcome: 'no_active_task' });
    expect(reminder.remind).not.toHaveBeenCalled();
  });

  test('requests a reminder from daemon state when the task was not handed off', async () => {
    const taskState = new InMemoryActiveTaskStateStore();
    taskState.start({ ...key, taskId: version.taskId });
    const reminder = { remind: vi.fn().mockResolvedValue(undefined) };

    const result = await handleAgentTurnEnded(
      { taskState, reminder },
      { ...key, version, eventId: 'event_1' }
    );

    expect(result).toEqual({
      outcome: 'reminder_requested',
      taskId: 'task_1',
      attempt: 1,
    });
    expect(reminder.remind).toHaveBeenCalledWith({
      chatroomId: 'room_1',
      role: 'builder',
      taskId: 'task_1',
      attempt: 1,
    });
  });

  test('completes a task that was already handed off', async () => {
    const taskState = new InMemoryActiveTaskStateStore();
    taskState.start({ ...key, taskId: version.taskId });
    taskState.markHandedOff(key, version);
    const reminder = { remind: vi.fn() };

    const result = await handleAgentTurnEnded(
      { taskState, reminder },
      { ...key, version, eventId: 'event_1' }
    );

    expect(result).toEqual({ outcome: 'already_handed_off', taskId: 'task_1' });
    expect(taskState.get(key)).toBeUndefined();
    expect(reminder.remind).not.toHaveBeenCalled();
  });

  test('rejects stale and duplicate turn-end events', async () => {
    const taskState = new InMemoryActiveTaskStateStore();
    taskState.start({ ...key, taskId: version.taskId });
    const reminder = { remind: vi.fn().mockResolvedValue(undefined) };
    const deps = { taskState, reminder };

    expect(
      await handleAgentTurnEnded(deps, {
        ...key,
        version: { taskId: 'task_old', generation: 1 },
        eventId: 'event_old',
      })
    ).toEqual({ outcome: 'stale_event' });
    expect(await handleAgentTurnEnded(deps, { ...key, version, eventId: 'event_1' })).toMatchObject(
      {
        outcome: 'reminder_requested',
      }
    );
    expect(await handleAgentTurnEnded(deps, { ...key, version, eventId: 'event_1' })).toEqual({
      outcome: 'duplicate_event',
    });
    expect(reminder.remind).toHaveBeenCalledTimes(1);
  });
});
