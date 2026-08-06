import type { AssignedTaskInboundEvent } from './handle-assigned-task-inbound.js';

export interface DeliverAssignedTaskInboundDeps {
  dispatchInbound: (event: AssignedTaskInboundEvent) => Promise<void>;
}

export async function deliverAssignedTaskInbound(
  deps: DeliverAssignedTaskInboundDeps,
  event: AssignedTaskInboundEvent
): Promise<void> {
  await deps.dispatchInbound(event);
}
