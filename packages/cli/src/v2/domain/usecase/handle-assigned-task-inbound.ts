import type { InboundEvent } from '../entities/inbound-event.js';

export type AssignedTaskInboundEvent = Extract<
  InboundEvent,
  { type: 'assigned-task.signal' } | { type: 'assigned-task.presence' }
>;

export type HandleAssignedTaskInboundDeps = {
  deliverInbound?: (event: AssignedTaskInboundEvent) => Promise<void>;
};

export async function handleAssignedTaskInbound(
  deps: HandleAssignedTaskInboundDeps,
  event: AssignedTaskInboundEvent
): Promise<void> {
  if (deps.deliverInbound) {
    await deps.deliverInbound(event);
  }
}
