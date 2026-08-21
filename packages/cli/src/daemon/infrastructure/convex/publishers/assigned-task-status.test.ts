import { describe, expect, it, vi } from 'vitest';

import { createAssignedTaskStatusPublisher } from './assigned-task-status.js';

describe('createAssignedTaskStatusPublisher', () => {
  it('logs task delivered on delivered outcome', async () => {
    const logEvent = vi.fn().mockResolvedValue(undefined);
    const publisher = createAssignedTaskStatusPublisher({
      backend: { mutation: vi.fn(), query: vi.fn() },
      sessionId: 'sess-1',
      machineId: 'machine-1',
      logEvent,
    });

    await publisher.publish({
      type: 'task.status',
      taskId: 'task-1',
      role: 'builder',
      chatroomId: 'room-1',
      outcome: 'delivered',
    });

    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'agent.taskDelivered',
        chatroomId: 'room-1',
        role: 'builder',
        machineId: 'machine-1',
        taskId: 'task-1',
      })
    );
  });

  it('logs task delivery failed on delivery_failed outcome', async () => {
    const logEvent = vi.fn().mockResolvedValue(undefined);
    const publisher = createAssignedTaskStatusPublisher({
      backend: { mutation: vi.fn(), query: vi.fn() },
      sessionId: 'sess-1',
      machineId: 'machine-1',
      logEvent,
    });

    await publisher.publish({
      type: 'task.status',
      taskId: 'task-1',
      role: 'builder',
      chatroomId: 'room-1',
      outcome: 'delivery_failed',
      error: 'spawn failed',
    });

    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'agent.taskDeliveryFailed',
        chatroomId: 'room-1',
        role: 'builder',
        machineId: 'machine-1',
        taskId: 'task-1',
        error: 'spawn failed',
      })
    );
  });
});
