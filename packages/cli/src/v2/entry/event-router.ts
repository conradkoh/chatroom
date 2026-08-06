import type { InboundEvent } from '../domain/entities/inbound-event.js';
import {
  handleAssignedTaskInbound,
  type AssignedTaskInboundEvent,
  type HandleAssignedTaskInboundDeps,
} from '../domain/usecase/handle-assigned-task-inbound.js';
import {
  handleDirectHarnessInbound,
  type DirectHarnessInboundEvent,
  type HandleDirectHarnessInboundDeps,
} from '../domain/usecase/handle-direct-harness-inbound.js';

export type EventRouterDeps = {
  assignedTask: HandleAssignedTaskInboundDeps;
  directHarness: HandleDirectHarnessInboundDeps;
};

// fallow-ignore-next-line complexity
export async function routeInboundEvent(deps: EventRouterDeps, event: InboundEvent): Promise<void> {
  switch (event.type) {
    case 'assigned-task.signal':
    case 'assigned-task.presence':
      await handleAssignedTaskInbound(deps.assignedTask, event as AssignedTaskInboundEvent);
      break;
    case 'direct-harness.session-opened':
    case 'direct-harness.prompt':
    case 'direct-harness.command':
      await handleDirectHarnessInbound(deps.directHarness, event as DirectHarnessInboundEvent);
      break;
    default:
      void event;
  }
}
