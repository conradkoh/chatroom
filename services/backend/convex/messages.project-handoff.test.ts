import { beforeEach, describe, expect, it, vi } from 'vitest';

import { projectHandoffFromDaemon } from './messages';

const mockRequireMachineOwner = vi.fn();
const mockGetAndIncrementQueuePosition = vi.fn();
const mockCreateTask = vi.fn();

vi.mock('./auth/cli/machineAccess.js', () => ({
  requireMachineOwner: (...args: unknown[]) => mockRequireMachineOwner(...args),
}));

vi.mock('./lib/chatroomUtils.js', async (importOriginal) => {
  const actual = (await importOriginal()) as object;
  return {
    ...actual,
    getAndIncrementQueuePosition: (...args: unknown[]) => mockGetAndIncrementQueuePosition(...args),
  };
});

vi.mock('../src/domain/usecase/task/create-task.js', async (importOriginal) => {
  const actual = (await importOriginal()) as object;
  return {
    ...actual,
    createTask: (...args: unknown[]) => mockCreateTask(...args),
  };
});

function makeCtx(overrides?: Record<string, unknown>) {
  const db = {
    query: vi.fn().mockReturnValue({
      withIndex: vi.fn().mockReturnValue({
        first: vi.fn().mockResolvedValue(null),
        collect: vi.fn().mockResolvedValue([]),
        unique: vi.fn().mockResolvedValue(undefined),
      }),
    }),
    get: vi
      .fn()
      .mockImplementation(async (id: string) =>
        id === 'room-1'
          ? { _id: 'room-1', nextQueuePosition: 5 }
          : { _id: id, status: 'in_progress' }
      ),
    insert: vi.fn().mockResolvedValue('msg-convex-1'),
    patch: vi.fn().mockResolvedValue(undefined),
  };
  return {
    db,
    ...overrides,
  };
}

function makeArgs(overrides?: Record<string, unknown>) {
  return {
    sessionId: 'sess-1',
    machineId: 'machine-1',
    idempotencyKey: 'room-1:msg-1',
    chatroomId: 'room-1',
    senderRole: 'planner',
    content: 'handoff message',
    targetRole: 'builder',
    completedTaskIds: ['task-1'],
    newTaskId: 'task-new',
    timestamp: 100,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireMachineOwner.mockResolvedValue(undefined);
  mockGetAndIncrementQueuePosition.mockResolvedValue(6);
  mockCreateTask.mockResolvedValue({ taskId: 'cvx-task-1' });
});

describe('projectHandoffFromDaemon', () => {
  it('inserts handoff message and creates task on first projection', async () => {
    const ctx = makeCtx();
    const result = await (
      projectHandoffFromDaemon as unknown as {
        _handler: (ctx: unknown, args: unknown) => Promise<unknown>;
      }
    )._handler(ctx as never, makeArgs());

    expect(result).toEqual({ success: true, replayed: false, messageId: 'msg-convex-1' });
    expect(ctx.db.insert).toHaveBeenCalledWith(
      'chatroom_messages',
      expect.objectContaining({
        chatroomId: 'room-1',
        senderRole: 'planner',
        content: 'handoff message',
        targetRole: 'builder',
        type: 'handoff',
        idempotencyKey: 'room-1:msg-1',
      })
    );
    expect(mockCreateTask).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        chatroomId: 'room-1',
        forceStatus: 'pending',
        assignedTo: 'builder',
      })
    );
    expect(ctx.db.patch).toHaveBeenCalledWith(
      'chatroom_messages',
      'msg-convex-1',
      expect.objectContaining({ taskId: 'cvx-task-1' })
    );
  });

  it('is a no-op replay when the idempotency key already exists', async () => {
    const ctx = makeCtx();
    const first = vi
      .fn()
      .mockResolvedValue({ _id: 'existing-msg', idempotencyKey: 'room-1:msg-1' });
    ctx.db.query.mockReturnValue({ withIndex: vi.fn().mockReturnValue({ first }) });

    const result = await (
      projectHandoffFromDaemon as unknown as {
        _handler: (ctx: unknown, args: unknown) => Promise<unknown>;
      }
    )._handler(ctx as never, makeArgs());

    expect(result).toEqual({ success: true, replayed: true, messageId: 'existing-msg' });
    expect(ctx.db.insert).not.toHaveBeenCalled();
    expect(mockCreateTask).not.toHaveBeenCalled();
  });

  it('stores daemonTaskId and completes by daemon UUID lookup', async () => {
    const daemonTaskId = 'daemon-uuid-abc';
    const ctx = makeCtx();
    ctx.db.get.mockImplementation(async (id: string) =>
      id === 'room-1' ? { _id: 'room-1', nextQueuePosition: 5 } : null
    );
    ctx.db.query.mockImplementation((table: string) => ({
      withIndex: vi.fn().mockReturnValue({
        first: vi.fn().mockResolvedValue(
          table === 'chatroom_tasks'
            ? { _id: 'cvx-task-1', status: 'in_progress', daemonTaskId }
            : null
        ),
        unique: vi.fn().mockResolvedValue(undefined),
      }),
    }));
    await (
      projectHandoffFromDaemon as unknown as { _handler: (ctx: unknown, args: unknown) => Promise<unknown> }
    )._handler(ctx as never, makeArgs({ newTaskId: daemonTaskId, completedTaskIds: [daemonTaskId] }));
    expect(ctx.db.patch).toHaveBeenCalledWith(
      'chatroom_tasks',
      'cvx-task-1',
      expect.objectContaining({ daemonTaskId })
    );
    expect(ctx.db.patch).toHaveBeenCalledWith(
      'chatroom_tasks',
      'cvx-task-1',
      expect.objectContaining({ status: 'completed' })
    );
  });
});
