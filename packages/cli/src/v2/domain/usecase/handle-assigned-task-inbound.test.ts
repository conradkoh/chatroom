import { describe, expect, test, vi } from 'vitest';

import {
  handleAssignedTaskInbound,
  type AssignedTaskInboundEvent,
} from './handle-assigned-task-inbound.js';

describe('handleAssignedTaskInbound', () => {
  test('invokes onTaskMonitorEvent when provided', async () => {
    const onTaskMonitorEvent = vi.fn().mockResolvedValue(undefined);
    const event: AssignedTaskInboundEvent = {
      type: 'assigned-task.signal',
      taskId: 'task_1',
      role: 'builder',
    };

    await handleAssignedTaskInbound({ onTaskMonitorEvent }, event);

    expect(onTaskMonitorEvent).toHaveBeenCalledWith(event);
  });

  test('no-ops when hook is absent', async () => {
    await expect(
      handleAssignedTaskInbound(
        {},
        { type: 'assigned-task.presence', taskId: 'task_1', role: 'builder' }
      )
    ).resolves.toBeUndefined();
  });
});
