import type { AssignedTaskInboundEvent } from '../domain/usecase/handle-assigned-task-inbound.js';

export type AssignedTaskMonitorHandler = (event: AssignedTaskInboundEvent) => Promise<void>;

let handler: AssignedTaskMonitorHandler | undefined;

export function registerAssignedTaskMonitorHandler(h: AssignedTaskMonitorHandler): void {
  handler = h;
}

export function unregisterAssignedTaskMonitorHandler(): void {
  handler = undefined;
}

export async function dispatchAssignedTaskMonitorEvent(
  event: AssignedTaskInboundEvent
): Promise<void> {
  if (handler) await handler(event);
}
