import type { OutboundEvent } from '../entities/outbound-event.js';

export type TaskClaimedEvent = Extract<OutboundEvent, { type: 'task.claimed' }>;
export type TaskStatusChangedEvent = Extract<OutboundEvent, { type: 'task.status_changed' }>;

export function buildTaskClaimedEvent(
  fields: Omit<TaskClaimedEvent, 'type' | 'idempotencyKey'>
): TaskClaimedEvent {
  return {
    type: 'task.claimed',
    idempotencyKey: `${fields.chatroomId}:${fields.role}:${fields.taskId}:claim`,
    ...fields,
  };
}

export function buildTaskStatusChangedEvent(
  fields: Omit<TaskStatusChangedEvent, 'type' | 'idempotencyKey'>
): TaskStatusChangedEvent {
  return {
    type: 'task.status_changed',
    idempotencyKey: `${fields.chatroomId}:${fields.role}:${fields.taskId}:${fields.status}`,
    ...fields,
  };
}
