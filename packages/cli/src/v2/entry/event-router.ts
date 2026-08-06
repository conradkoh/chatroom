import type { InboundEvent } from '../domain/entities/inbound-event.js';
import {
  handleAssignedTaskInbound,
  type AssignedTaskInboundEvent,
  type HandleAssignedTaskInboundDeps,
} from '../domain/usecase/handle-assigned-task-inbound.js';

export type EventRouterDeps = {
  assignedTask: HandleAssignedTaskInboundDeps;
};

export async function routeInboundEvent(deps: EventRouterDeps, event: InboundEvent): Promise<void> {
  switch (event.type) {
    case 'assigned-task.signal':
    case 'assigned-task.presence':
      await handleAssignedTaskInbound(deps.assignedTask, event as AssignedTaskInboundEvent);
      break;
    default:
      void event;
  }
}
