/**
 * Unit tests for the promote-next-task usecase
 *
 * All tests use injected mocks — no Convex runtime, no database.
 * This validates the pure logic of the usecase in isolation.
 */

import { describe, expect, test, vi } from 'vitest';

import { type PromoteNextTaskDeps, type QueuedMessage, promoteNextTask } from './promote-next-task';
import type { Id } from '../../../../convex/_generated/dataModel';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CHATROOM_ID = 'chatroom_rooms:test' as Id<'chatroom_rooms'>;
const QUEUE_MSG_ID_A = 'chatroom_messageQueue:a' as Id<'chatroom_messageQueue'>;
const TASK_ID_A = 'chatroom_tasks:a' as Id<'chatroom_tasks'>;

function makeQueueMsg(id: Id<'chatroom_messageQueue'>, queuePosition: number): QueuedMessage {
  return { _id: id, queuePosition };
}

function makeDeps(overrides: Partial<PromoteNextTaskDeps> = {}): PromoteNextTaskDeps {
  return {
    areAllAgentsWaiting: vi.fn().mockResolvedValue(true),
    getOldestQueuedMessage: vi.fn().mockResolvedValue(makeQueueMsg(QUEUE_MSG_ID_A, 1)),
    promoteQueuedMessage: vi.fn().mockResolvedValue({ taskId: TASK_ID_A }),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests: happy path
// ---------------------------------------------------------------------------

describe('promoteNextTask — happy path', () => {
  test('promotes the oldest queued message when all agents are waiting', async () => {
    const deps = makeDeps();

    const result = await promoteNextTask(CHATROOM_ID, deps);

    expect(result).toEqual({ promoted: TASK_ID_A, reason: 'success' });
    expect(deps.areAllAgentsWaiting).toHaveBeenCalledWith(CHATROOM_ID);
    expect(deps.getOldestQueuedMessage).toHaveBeenCalledWith(CHATROOM_ID);
    expect(deps.promoteQueuedMessage).toHaveBeenCalledWith(QUEUE_MSG_ID_A);
  });

  test('promotes the message with the lowest queuePosition when multiple exist', async () => {
    const deps = makeDeps({
      getOldestQueuedMessage: vi.fn().mockResolvedValue(makeQueueMsg(QUEUE_MSG_ID_A, 1)),
    });

    const result = await promoteNextTask(CHATROOM_ID, deps);

    expect(result.promoted).toBe(TASK_ID_A);
    expect(deps.promoteQueuedMessage).toHaveBeenCalledWith(QUEUE_MSG_ID_A);
  });

  test('calls areAllAgentsWaiting before getOldestQueuedMessage (guard order)', async () => {
    const callOrder: string[] = [];
    const deps = makeDeps({
      areAllAgentsWaiting: vi.fn().mockImplementation(async () => {
        callOrder.push('areAllAgentsWaiting');
        return true;
      }),
      getOldestQueuedMessage: vi.fn().mockImplementation(async () => {
        callOrder.push('getOldestQueuedMessage');
        return makeQueueMsg(QUEUE_MSG_ID_A, 1);
      }),
    });

    await promoteNextTask(CHATROOM_ID, deps);

    expect(callOrder).toEqual(['areAllAgentsWaiting', 'getOldestQueuedMessage']);
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
    expect(deps.getOldestQueuedMessage).not.toHaveBeenCalled();
    expect(deps.promoteQueuedMessage).not.toHaveBeenCalled();
  });

  test('returns no_queued_tasks when queue is empty', async () => {
    const deps = makeDeps({
      getOldestQueuedMessage: vi.fn().mockResolvedValue(null),
    });

    const result = await promoteNextTask(CHATROOM_ID, deps);

    expect(result).toEqual({ promoted: null, reason: 'no_queued_tasks' });
    expect(deps.promoteQueuedMessage).not.toHaveBeenCalled();
  });

  test('does not promote when agents are waiting but queue is empty', async () => {
    const deps = makeDeps({
      areAllAgentsWaiting: vi.fn().mockResolvedValue(true),
      getOldestQueuedMessage: vi.fn().mockResolvedValue(null),
    });

    const result = await promoteNextTask(CHATROOM_ID, deps);

    expect(result.promoted).toBeNull();
    expect(deps.promoteQueuedMessage).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Tests: error propagation
// ---------------------------------------------------------------------------

describe('promoteNextTask — error propagation', () => {
  test('propagates errors thrown by promoteQueuedMessage', async () => {
    const deps = makeDeps({
      promoteQueuedMessage: vi.fn().mockRejectedValue(new Error('Promotion error')),
    });

    await expect(promoteNextTask(CHATROOM_ID, deps)).rejects.toThrow('Promotion error');
  });

  test('propagates errors thrown by areAllAgentsWaiting', async () => {
    const deps = makeDeps({
      areAllAgentsWaiting: vi.fn().mockRejectedValue(new Error('DB error')),
    });

    await expect(promoteNextTask(CHATROOM_ID, deps)).rejects.toThrow('DB error');
  });

  test('propagates errors thrown by getOldestQueuedMessage', async () => {
    const deps = makeDeps({
      getOldestQueuedMessage: vi.fn().mockRejectedValue(new Error('query failed')),
    });

    await expect(promoteNextTask(CHATROOM_ID, deps)).rejects.toThrow('query failed');
  });
});

// ---------------------------------------------------------------------------
// Tests: side-effect boundaries
// ---------------------------------------------------------------------------

describe('promoteNextTask — side-effect boundaries', () => {
  test('only promotes exactly one message per call', async () => {
    const deps = makeDeps({
      getOldestQueuedMessage: vi.fn().mockResolvedValue(makeQueueMsg(QUEUE_MSG_ID_A, 1)),
    });

    await promoteNextTask(CHATROOM_ID, deps);

    expect(deps.promoteQueuedMessage).toHaveBeenCalledTimes(1);
    expect(deps.promoteQueuedMessage).toHaveBeenCalledWith(QUEUE_MSG_ID_A);
  });

  test('passes exactly the chatroomId to areAllAgentsWaiting', async () => {
    const OTHER_ID = 'chatroom_rooms:other' as Id<'chatroom_rooms'>;
    const deps = makeDeps();

    await promoteNextTask(OTHER_ID, deps);

    expect(deps.areAllAgentsWaiting).toHaveBeenCalledWith(OTHER_ID);
  });

  test('passes exactly the chatroomId to getOldestQueuedMessage', async () => {
    const OTHER_ID = 'chatroom_rooms:other' as Id<'chatroom_rooms'>;
    const deps = makeDeps();

    await promoteNextTask(OTHER_ID, deps);

    expect(deps.getOldestQueuedMessage).toHaveBeenCalledWith(OTHER_ID);
  });
});
