import { describe, expect, it, vi } from 'vitest';

import { createHandoffCompletedPublisher } from './handoff-completed.js';

describe('createHandoffCompletedPublisher', () => {
  it('calls projectHandoffFromDaemon with the event payload mapped to mutation args', async () => {
    const mutation = vi.fn().mockResolvedValue({ success: true });
    const publisher = createHandoffCompletedPublisher({
      backend: { mutation, query: vi.fn() },
      sessionId: 'sess-1',
      machineId: 'machine-1',
    });

    await publisher.publish({
      type: 'handoff.completed',
      idempotencyKey: 'room-1:msg-1',
      sessionId: 'sess-1',
      chatroomId: 'room-1',
      senderRole: 'planner',
      content: 'handoff message',
      targetRole: 'builder',
      messageId: 'msg-1',
      completedTaskIds: ['task-1', 'task-2'],
      newTaskId: 'task-new',
      promotedTaskId: 'task-promoted',
      timestamp: 100,
    });

    expect(mutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        sessionId: 'sess-1',
        machineId: 'machine-1',
        idempotencyKey: 'room-1:msg-1',
        chatroomId: 'room-1',
        senderRole: 'planner',
        targetRole: 'builder',
        completedTaskIds: ['task-1', 'task-2'],
        newTaskId: 'task-new',
        promotedTaskId: 'task-promoted',
        timestamp: 100,
      })
    );
  });

  it('is a no-op for non-handoff events', async () => {
    const mutation = vi.fn();
    const publisher = createHandoffCompletedPublisher({
      backend: { mutation, query: vi.fn() },
      sessionId: 'sess-1',
      machineId: 'machine-1',
    });

    await publisher.publish({ type: 'heartbeat', machineId: 'machine-1' });

    expect(mutation).not.toHaveBeenCalled();
  });
});
