import { deliverAssignedTaskInbound } from '../../domain/usecase/deliver-assigned-task.js';
import type { DeliverAssignedTaskInboundDeps } from '../../domain/usecase/deliver-assigned-task.js';
import type { HandleAssignedTaskInboundDeps } from '../../domain/usecase/handle-assigned-task-inbound.js';
import { dispatchAssignedTaskMonitorEvent } from '../assigned-task-monitor-registry.js';

function createDeliverAssignedTaskDeps(): DeliverAssignedTaskInboundDeps {
  return { dispatchInbound: dispatchAssignedTaskMonitorEvent };
}

export function createAssignedTaskRouterDeps(): HandleAssignedTaskInboundDeps {
  return {
    deliverInbound: async (event) => {
      await deliverAssignedTaskInbound(createDeliverAssignedTaskDeps(), event);
    },
  };
}
