import { describe, expect, it, vi } from 'vitest';
import type { AssignedTaskPresenceSignal, AssignedTaskSignal } from '@workspace/backend/src/domain/usecase/machine/assigned-tasks-types.js';

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
      signal: {} as AssignedTaskSignal,
    };

    await deliverAssignedTaskInbound(deps, event);

    expect(dispatchInbound).toHaveBeenCalledWith(event);
  });

  it('dispatches presence events to port', async () => {
    const dispatchInbound = vi.fn().mockResolvedValue(undefined);
    const deps: DeliverAssignedTaskInboundDeps = { dispatchInbound };
    const event: AssignedTaskInboundEvent = {
      type: 'assigned-task.presence',
      presence: {} as AssignedTaskPresenceSignal,
    };

    await deliverAssignedTaskInbound(deps, event);

    expect(dispatchInbound).toHaveBeenCalledWith(event);
  });
});
