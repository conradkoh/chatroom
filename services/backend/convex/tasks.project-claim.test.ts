import { beforeEach, describe, expect, it, vi } from 'vitest';

import { projectTaskClaimFromDaemon, projectTaskStatusFromDaemon } from './tasks';

const mockRequireMachineOwner = vi.fn();
const mockAcknowledgePendingTask = vi.fn();
const mockRecordTaskDelivery = vi.fn();
const mockTransitionTask = vi.fn();
const mockTransitionAgentStatus = vi.fn();

vi.mock('./auth/cli/machineAccess.js', () => ({
  requireMachineOwner: (...args: unknown[]) => mockRequireMachineOwner(...args),
}));

vi.mock('../src/domain/usecase/task/acknowledge-pending-task.js', () => ({
  acknowledgePendingTask: (...args: unknown[]) => mockAcknowledgePendingTask(...args),
}));

vi.mock('../src/domain/usecase/task/record-task-delivery.js', () => ({
  recordTaskDelivery: (...args: unknown[]) => mockRecordTaskDelivery(...args),
}));

vi.mock('../src/domain/usecase/task/transition-task.js', () => ({
  transitionTask: (...args: unknown[]) => mockTransitionTask(...args),
}));

vi.mock('../src/domain/usecase/agent/transition-agent-status.js', () => ({
  transitionAgentStatus: (...args: unknown[]) => mockTransitionAgentStatus(...args),
}));

function makeCtx(task: { _id: string; status: string; assignedTo?: string } | null) {
  const db = {
    get: vi.fn().mockResolvedValue(task ? { ...task, chatroomId: 'room-1' } : null),
    patch: vi.fn().mockResolvedValue(undefined),
  };
  return { db };
}

function makeClaimArgs(overrides?: Record<string, unknown>) {
  return {
    sessionId: 'sess-1',
    machineId: 'machine-1',
    idempotencyKey: 'room-1:builder:task-1:claim',
    chatroomId: 'room-1',
    role: 'builder',
    taskId: 'task-1',
    messageId: 'msg-1',
    timestamp: 100,
    ...overrides,
  };
}

function makeStatusArgs(overrides?: Record<string, unknown>) {
  return {
    sessionId: 'sess-1',
    machineId: 'machine-1',
    idempotencyKey: 'room-1:builder:task-1:in_progress',
    chatroomId: 'room-1',
    role: 'builder',
    taskId: 'task-1',
    status: 'in_progress',
    timestamp: 100,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireMachineOwner.mockResolvedValue(undefined);
  mockAcknowledgePendingTask.mockResolvedValue(undefined);
  mockRecordTaskDelivery.mockResolvedValue('receipt-1');
  mockTransitionTask.mockResolvedValue(undefined);
  mockTransitionAgentStatus.mockResolvedValue(undefined);
});

describe('projectTaskClaimFromDaemon', () => {
  it('acknowledges a pending task and records the receipt on first projection', async () => {
    const ctx = makeCtx({ _id: 'task-1', status: 'pending' });
    const result = await (
      projectTaskClaimFromDaemon as unknown as {
        _handler: (ctx: unknown, args: unknown) => Promise<unknown>;
      }
    )._handler(ctx as never, makeClaimArgs());

    expect(result).toEqual({ success: true, replayed: false, taskId: 'task-1' });
    expect(mockAcknowledgePendingTask).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({ chatroomId: 'room-1', role: 'builder' })
    );
    expect(mockRecordTaskDelivery).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({ taskId: 'task-1', deliveryKind: 'cli_get_next_task' })
    );
  });

  it('is a no-op replay when the task is already acknowledged by the role', async () => {
    const ctx = makeCtx({ _id: 'task-1', status: 'acknowledged', assignedTo: 'builder' });
    const result = await (
      projectTaskClaimFromDaemon as unknown as {
        _handler: (ctx: unknown, args: unknown) => Promise<unknown>;
      }
    )._handler(ctx as never, makeClaimArgs());

    expect(result).toEqual({ success: true, replayed: true, taskId: 'task-1' });
    expect(mockAcknowledgePendingTask).not.toHaveBeenCalled();
  });

  it('no-ops when the task is claimed by another role (replay)', async () => {
    const ctx = makeCtx({ _id: 'task-1', status: 'in_progress', assignedTo: 'planner' });
    const result = await (
      projectTaskClaimFromDaemon as unknown as {
        _handler: (ctx: unknown, args: unknown) => Promise<unknown>;
      }
    )._handler(ctx as never, makeClaimArgs());

    expect(result).toEqual({ success: false, replayed: true, taskId: 'task-1' });
    expect(mockAcknowledgePendingTask).not.toHaveBeenCalled();
  });
});

describe('projectTaskStatusFromDaemon', () => {
  it('transitions acknowledged → in_progress idempotently', async () => {
    const ctx = makeCtx({ _id: 'task-1', status: 'acknowledged' });
    const result = await (
      projectTaskStatusFromDaemon as unknown as {
        _handler: (ctx: unknown, args: unknown) => Promise<unknown>;
      }
    )._handler(ctx as never, makeStatusArgs());

    expect(result).toEqual({ success: true, replayed: false, taskId: 'task-1' });
    expect(mockTransitionTask).toHaveBeenCalledWith(
      ctx,
      'task-1',
      'in_progress',
      'projectTaskStatusFromDaemon'
    );
  });

  it('replays when the task is already in the target status', async () => {
    const ctx = makeCtx({ _id: 'task-1', status: 'in_progress' });
    const result = await (
      projectTaskStatusFromDaemon as unknown as {
        _handler: (ctx: unknown, args: unknown) => Promise<unknown>;
      }
    )._handler(ctx as never, makeStatusArgs());

    expect(result).toEqual({ success: true, replayed: true, taskId: 'task-1' });
    expect(mockTransitionTask).not.toHaveBeenCalled();
  });
});
