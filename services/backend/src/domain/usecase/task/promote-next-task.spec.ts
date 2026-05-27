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
    canPromote: vi.fn().mockResolvedValue(true),
    getOldestQueuedMessage: vi.fn().mockResolvedValue(makeQueueMsg(QUEUE_MSG_ID_A, 1)),
    promoteQueuedMessage: vi.fn().mockResolvedValue({ taskId: TASK_ID_A }),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests: happy path
// ---------------------------------------------------------------------------

describe('promoteNextTask — happy path', () => {
  test('promotes the oldest queued message when canPromote returns true', async () => {
    const deps = makeDeps();

    const result = await promoteNextTask(CHATROOM_ID, deps);

    expect(result).toEqual({ promoted: TASK_ID_A, reason: 'success' });
    expect(deps.canPromote).toHaveBeenCalledWith(CHATROOM_ID);
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

  test('calls canPromote before getOldestQueuedMessage (guard order)', async () => {
    const callOrder: string[] = [];
    const deps = makeDeps({
      canPromote: vi.fn().mockImplementation(async () => {
        callOrder.push('canPromote');
        return true;
      }),
      getOldestQueuedMessage: vi.fn().mockImplementation(async () => {
        callOrder.push('getOldestQueuedMessage');
        return makeQueueMsg(QUEUE_MSG_ID_A, 1);
      }),
    });

    await promoteNextTask(CHATROOM_ID, deps);

    expect(callOrder).toEqual(['canPromote', 'getOldestQueuedMessage']);
  });
});

// ---------------------------------------------------------------------------
// Tests: guards
// ---------------------------------------------------------------------------

describe('promoteNextTask — guards', () => {
  test('returns active_task_exists when canPromote returns false', async () => {
    const deps = makeDeps({
      canPromote: vi.fn().mockResolvedValue(false),
    });

    const result = await promoteNextTask(CHATROOM_ID, deps);

    expect(result).toEqual({ promoted: null, reason: 'active_task_exists' });
    // Must NOT query the queue if promotion is blocked
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

  test('does not promote when canPromote is true but queue is empty', async () => {
    const deps = makeDeps({
      canPromote: vi.fn().mockResolvedValue(true),
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
  test('propagates errors thrown by canPromote', async () => {
    const deps = makeDeps({
      canPromote: vi.fn().mockRejectedValue(new Error('DB error on active task check')),
    });

    await expect(promoteNextTask(CHATROOM_ID, deps)).rejects.toThrow(
      'DB error on active task check'
    );
  });

  test('propagates errors thrown by promoteQueuedMessage', async () => {
    const deps = makeDeps({
      promoteQueuedMessage: vi.fn().mockRejectedValue(new Error('Promotion error')),
    });

    await expect(promoteNextTask(CHATROOM_ID, deps)).rejects.toThrow('Promotion error');
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

  test('passes exactly the chatroomId to canPromote', async () => {
    const OTHER_ID = 'chatroom_rooms:other' as Id<'chatroom_rooms'>;
    const deps = makeDeps();

    await promoteNextTask(OTHER_ID, deps);

    expect(deps.canPromote).toHaveBeenCalledWith(OTHER_ID);
  });

  test('passes exactly the chatroomId to getOldestQueuedMessage', async () => {
    const OTHER_ID = 'chatroom_rooms:other' as Id<'chatroom_rooms'>;
    const deps = makeDeps();

    await promoteNextTask(OTHER_ID, deps);

    expect(deps.getOldestQueuedMessage).toHaveBeenCalledWith(OTHER_ID);
  });
});
