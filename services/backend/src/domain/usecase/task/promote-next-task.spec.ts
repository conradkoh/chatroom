/**
 * Unit tests for the promote-next-task usecase
 *
 * All tests use injected mocks — no Convex runtime, no database.
 * This validates the pure logic of the usecase in isolation.
 */

import { describe, expect, test, vi } from 'vitest';

import { type PromoteNextTaskDeps, type QueuedTask, promoteNextTask } from './promote-next-task';
import type { Id } from '../../../../convex/_generated/dataModel';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CHATROOM_ID = 'chatroom_rooms:test' as Id<'chatroom_rooms'>;
const TASK_ID_A = 'chatroom_tasks:a' as Id<'chatroom_tasks'>;

function makeTask(id: Id<'chatroom_tasks'>, queuePosition: number): QueuedTask {
  return { _id: id, queuePosition };
}

function makeDeps(overrides: Partial<PromoteNextTaskDeps> = {}): PromoteNextTaskDeps {
  return {
    areAllAgentsWaiting: vi.fn().mockResolvedValue(true),
    getOldestQueuedTask: vi.fn().mockResolvedValue(makeTask(TASK_ID_A, 1)),
    transitionTaskToPending: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests: happy path
// ---------------------------------------------------------------------------

describe('promoteNextTask — happy path', () => {
  test('promotes the oldest queued task when all agents are waiting', async () => {
    const deps = makeDeps();

    const result = await promoteNextTask(CHATROOM_ID, deps);

    expect(result).toEqual({ promoted: TASK_ID_A, reason: 'success' });
    expect(deps.areAllAgentsWaiting).toHaveBeenCalledWith(CHATROOM_ID);
    expect(deps.getOldestQueuedTask).toHaveBeenCalledWith(CHATROOM_ID);
    expect(deps.transitionTaskToPending).toHaveBeenCalledWith(TASK_ID_A);
  });

  test('promotes the task with the lowest queuePosition when multiple exist', async () => {
    // Simulate deps already returning the oldest (lowest position) task
    const deps = makeDeps({
      getOldestQueuedTask: vi.fn().mockResolvedValue(makeTask(TASK_ID_A, 1)),
    });

    const result = await promoteNextTask(CHATROOM_ID, deps);

    expect(result.promoted).toBe(TASK_ID_A);
    expect(deps.transitionTaskToPending).toHaveBeenCalledWith(TASK_ID_A);
  });

  test('calls areAllAgentsWaiting before getOldestQueuedTask (guard order)', async () => {
    const callOrder: string[] = [];
    const deps = makeDeps({
      areAllAgentsWaiting: vi.fn().mockImplementation(async () => {
        callOrder.push('areAllAgentsWaiting');
        return true;
      }),
      getOldestQueuedTask: vi.fn().mockImplementation(async () => {
        callOrder.push('getOldestQueuedTask');
        return makeTask(TASK_ID_A, 1);
      }),
    });

    await promoteNextTask(CHATROOM_ID, deps);

    expect(callOrder).toEqual(['areAllAgentsWaiting', 'getOldestQueuedTask']);
  });
});

// ---------------------------------------------------------------------------
// Tests: guards
// ---------------------------------------------------------------------------

describe('promoteNextTask — guards', () => {
  test('returns agents_busy when not all agents are waiting', async () => {
    const deps = makeDeps({
      areAllAgentsWaiting: vi.fn().mockResolvedValue(false),
    });

    const result = await promoteNextTask(CHATROOM_ID, deps);

    expect(result).toEqual({ promoted: null, reason: 'agents_busy' });
    // Must NOT query the queue if agents are busy
    expect(deps.getOldestQueuedTask).not.toHaveBeenCalled();
    expect(deps.transitionTaskToPending).not.toHaveBeenCalled();
  });

  test('returns no_queued_tasks when queue is empty', async () => {
    const deps = makeDeps({
      getOldestQueuedTask: vi.fn().mockResolvedValue(null),
    });

    const result = await promoteNextTask(CHATROOM_ID, deps);

    expect(result).toEqual({ promoted: null, reason: 'no_queued_tasks' });
    expect(deps.transitionTaskToPending).not.toHaveBeenCalled();
  });

  test('does not promote when agents are waiting but queue is empty', async () => {
    const deps = makeDeps({
      areAllAgentsWaiting: vi.fn().mockResolvedValue(true),
      getOldestQueuedTask: vi.fn().mockResolvedValue(null),
    });

    const result = await promoteNextTask(CHATROOM_ID, deps);

    expect(result.promoted).toBeNull();
    expect(deps.transitionTaskToPending).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Tests: transitionTaskToPending errors propagate
// ---------------------------------------------------------------------------

describe('promoteNextTask — error propagation', () => {
  test('propagates errors thrown by transitionTaskToPending', async () => {
    const deps = makeDeps({
      transitionTaskToPending: vi.fn().mockRejectedValue(new Error('FSM error')),
    });

    await expect(promoteNextTask(CHATROOM_ID, deps)).rejects.toThrow('FSM error');
  });

  test('propagates errors thrown by areAllAgentsWaiting', async () => {
    const deps = makeDeps({
      areAllAgentsWaiting: vi.fn().mockRejectedValue(new Error('DB error')),
    });

    await expect(promoteNextTask(CHATROOM_ID, deps)).rejects.toThrow('DB error');
  });

  test('propagates errors thrown by getOldestQueuedTask', async () => {
    const deps = makeDeps({
      getOldestQueuedTask: vi.fn().mockRejectedValue(new Error('query failed')),
    });

    await expect(promoteNextTask(CHATROOM_ID, deps)).rejects.toThrow('query failed');
  });
});

// ---------------------------------------------------------------------------
// Tests: idempotency and side-effect boundaries
// ---------------------------------------------------------------------------

describe('promoteNextTask — side-effect boundaries', () => {
  test('only transitions exactly one task per call', async () => {
    const deps = makeDeps({
      // getOldestQueuedTask always returns the same task
      getOldestQueuedTask: vi.fn().mockResolvedValue(makeTask(TASK_ID_A, 1)),
    });

    await promoteNextTask(CHATROOM_ID, deps);

    expect(deps.transitionTaskToPending).toHaveBeenCalledTimes(1);
    expect(deps.transitionTaskToPending).toHaveBeenCalledWith(TASK_ID_A);
  });

  test('passes exactly the chatroomId to areAllAgentsWaiting', async () => {
    const OTHER_ID = 'chatroom_rooms:other' as Id<'chatroom_rooms'>;
    const deps = makeDeps();

    await promoteNextTask(OTHER_ID, deps);

    expect(deps.areAllAgentsWaiting).toHaveBeenCalledWith(OTHER_ID);
  });

  test('passes exactly the chatroomId to getOldestQueuedTask', async () => {
    const OTHER_ID = 'chatroom_rooms:other' as Id<'chatroom_rooms'>;
    const deps = makeDeps();

    await promoteNextTask(OTHER_ID, deps);

    expect(deps.getOldestQueuedTask).toHaveBeenCalledWith(OTHER_ID);
  });
});
