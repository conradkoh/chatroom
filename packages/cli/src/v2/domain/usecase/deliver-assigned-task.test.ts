import { describe, expect, it, vi } from 'vitest';

import {
  deliverAssignedTaskInbound,
  type DeliverAssignedTaskInboundDeps,
} from './deliver-assigned-task.js';
import type { AssignedTaskInboundEvent } from './handle-assigned-task-inbound.js';

describe('deliverAssignedTaskInbound', () => {
  it('dispatches signal events to port', async () => {
    const dispatchInbound = vi.fn().mockResolvedValue(undefined);
    const deps: DeliverAssignedTaskInboundDeps = { dispatchInbound };
    const event: AssignedTaskInboundEvent = {
      type: 'assigned-task.signal',
      taskId: 'task_1',
      role: 'builder',
    };

    await deliverAssignedTaskInbound(deps, event);

    expect(dispatchInbound).toHaveBeenCalledWith(event);
  });

  it('dispatches presence events to port', async () => {
    const dispatchInbound = vi.fn().mockResolvedValue(undefined);
    const deps: DeliverAssignedTaskInboundDeps = { dispatchInbound };
    const event: AssignedTaskInboundEvent = {
      type: 'assigned-task.presence',
      taskId: 'task_2',
      role: 'planner',
    };

    await deliverAssignedTaskInbound(deps, event);

    expect(dispatchInbound).toHaveBeenCalledWith(event);
  });
});
