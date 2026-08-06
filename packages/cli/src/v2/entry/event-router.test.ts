import { describe, expect, test, vi } from 'vitest';

import { routeInboundEvent } from './event-router.js';
import type { AssignedTaskInboundEvent } from '../domain/usecase/handle-assigned-task-inbound.js';

describe('routeInboundEvent', () => {
  test('dispatches assigned-task.signal to handler', async () => {
    const onTaskMonitorEvent = vi.fn().mockResolvedValue(undefined);
    const event: AssignedTaskInboundEvent = {
      type: 'assigned-task.signal',
      taskId: 'task_1',
      role: 'builder',
    };

    await routeInboundEvent({ assignedTask: { onTaskMonitorEvent } }, event);

    expect(onTaskMonitorEvent).toHaveBeenCalledWith(event);
  });

  test('dispatches assigned-task.presence to handler', async () => {
    const onTaskMonitorEvent = vi.fn().mockResolvedValue(undefined);
    const event: AssignedTaskInboundEvent = {
      type: 'assigned-task.presence',
      taskId: 'task_1',
      role: 'planner',
    };

    await routeInboundEvent({ assignedTask: { onTaskMonitorEvent } }, event);

    expect(onTaskMonitorEvent).toHaveBeenCalledWith(event);
  });

  test('ignores unhandled event types', async () => {
    const onTaskMonitorEvent = vi.fn().mockResolvedValue(undefined);

    await routeInboundEvent(
      { assignedTask: { onTaskMonitorEvent } },
      { type: 'command.received', commandId: 'cmd_1' }
    );

    expect(onTaskMonitorEvent).not.toHaveBeenCalled();
  });
});
