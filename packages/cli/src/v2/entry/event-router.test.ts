import { describe, expect, test, vi } from 'vitest';

import { routeInboundEvent } from './event-router.js';
import type { AssignedTaskInboundEvent } from '../domain/usecase/handle-assigned-task-inbound.js';
import type { DirectHarnessInboundEvent } from '../domain/usecase/handle-direct-harness-inbound.js';

const routerDeps = {
  assignedTask: {} as { onTaskMonitorEvent?: (event: AssignedTaskInboundEvent) => Promise<void> },
  directHarness: {} as {
    onDirectHarnessEvent?: (event: DirectHarnessInboundEvent) => Promise<void>;
  },
};

describe('routeInboundEvent', () => {
  test('dispatches assigned-task.signal to handler', async () => {
    const onTaskMonitorEvent = vi.fn().mockResolvedValue(undefined);
    const event: AssignedTaskInboundEvent = {
      type: 'assigned-task.signal',
      taskId: 'task_1',
      role: 'builder',
    };

    await routeInboundEvent({ ...routerDeps, assignedTask: { onTaskMonitorEvent } }, event);

    expect(onTaskMonitorEvent).toHaveBeenCalledWith(event);
  });

  test('dispatches assigned-task.presence to handler', async () => {
    const onTaskMonitorEvent = vi.fn().mockResolvedValue(undefined);
    const event: AssignedTaskInboundEvent = {
      type: 'assigned-task.presence',
      taskId: 'task_1',
      role: 'planner',
    };

    await routeInboundEvent({ ...routerDeps, assignedTask: { onTaskMonitorEvent } }, event);

    expect(onTaskMonitorEvent).toHaveBeenCalledWith(event);
  });

  test('dispatches direct-harness.session-opened to handler', async () => {
    const onDirectHarnessEvent = vi.fn().mockResolvedValue(undefined);
    const event: DirectHarnessInboundEvent = {
      type: 'direct-harness.session-opened',
      harnessSessionId: 'harness_1',
    };

    await routeInboundEvent({ ...routerDeps, directHarness: { onDirectHarnessEvent } }, event);

    expect(onDirectHarnessEvent).toHaveBeenCalledWith(event);
  });

  test('dispatches direct-harness.prompt to handler', async () => {
    const onDirectHarnessEvent = vi.fn().mockResolvedValue(undefined);
    const event: DirectHarnessInboundEvent = {
      type: 'direct-harness.prompt',
      harnessSessionId: 'harness_1',
    };

    await routeInboundEvent({ ...routerDeps, directHarness: { onDirectHarnessEvent } }, event);

    expect(onDirectHarnessEvent).toHaveBeenCalledWith(event);
  });

  test('dispatches direct-harness.command to handler', async () => {
    const onDirectHarnessEvent = vi.fn().mockResolvedValue(undefined);
    const event: DirectHarnessInboundEvent = {
      type: 'direct-harness.command',
      commandId: 'cmd_1',
    };

    await routeInboundEvent({ ...routerDeps, directHarness: { onDirectHarnessEvent } }, event);

    expect(onDirectHarnessEvent).toHaveBeenCalledWith(event);
  });

  test('ignores unhandled event types', async () => {
    const onTaskMonitorEvent = vi.fn().mockResolvedValue(undefined);
    const onDirectHarnessEvent = vi.fn().mockResolvedValue(undefined);

    await routeInboundEvent(
      {
        assignedTask: { onTaskMonitorEvent },
        directHarness: { onDirectHarnessEvent },
      },
      { type: 'command.received', commandId: 'cmd_1' }
    );

    expect(onTaskMonitorEvent).not.toHaveBeenCalled();
    expect(onDirectHarnessEvent).not.toHaveBeenCalled();
  });
});
