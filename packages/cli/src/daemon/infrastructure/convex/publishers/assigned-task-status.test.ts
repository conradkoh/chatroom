import { describe, expect, it, vi } from 'vitest';

import { createAssignedTaskStatusPublisher } from './assigned-task-status.js';

describe('createAssignedTaskStatusPublisher', () => {
  it('emits task delivered on delivered outcome', async () => {
    const mutation = vi.fn().mockResolvedValue(undefined);
    const publisher = createAssignedTaskStatusPublisher({
      backend: { mutation, query: vi.fn() },
      sessionId: 'sess-1',
      machineId: 'machine-1',
    });

    await publisher.publish({
      type: 'task.status',
      taskId: 'task-1',
      role: 'builder',
      chatroomId: 'room-1',
      outcome: 'delivered',
    });

    expect(mutation).toHaveBeenCalledWith(expect.anything(), {
      sessionId: 'sess-1',
      machineId: 'machine-1',
      chatroomId: 'room-1',
      role: 'builder',
      taskId: 'task-1',
    });
  });

  it('emits task delivery failed on delivery_failed outcome', async () => {
    const mutation = vi.fn().mockResolvedValue(undefined);
    const publisher = createAssignedTaskStatusPublisher({
      backend: { mutation, query: vi.fn() },
      sessionId: 'sess-1',
      machineId: 'machine-1',
    });

    await publisher.publish({
      type: 'task.status',
      taskId: 'task-1',
      role: 'builder',
      chatroomId: 'room-1',
      outcome: 'delivery_failed',
      error: 'spawn failed',
    });

    expect(mutation).toHaveBeenCalledWith(expect.anything(), {
      sessionId: 'sess-1',
      machineId: 'machine-1',
      chatroomId: 'room-1',
      role: 'builder',
      taskId: 'task-1',
      error: 'spawn failed',
    });
  });
});
