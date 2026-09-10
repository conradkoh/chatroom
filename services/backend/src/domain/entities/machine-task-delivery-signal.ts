// fallow-ignore-file unused-export unused-type
/**
 * Canonical daemon-owned task-delivery signal model.
 *
 * Slim routing/status metadata only — never task content or full task rows.
 * Task content is hydrated imperatively from `chatroom_machineAssignedTaskSnapshots`.
 * Cursor convention is shared with the legacy machine task-status feed:
 * `signalKey = <zero-padded taskUpdatedAt>:<taskId>`, strict `>` for
 * subscription cursors, ascending ordering.
 */

import { v } from 'convex/values';

export const machineTaskDeliverySignalScopeValidator = {
  machineId: v.string(),
  chatroomId: v.id('chatroom_rooms'),
} as const;

export const machineTaskDeliveryTaskStatusValidator = v.union(
  v.literal('pending'),
  v.literal('acknowledged'),
  v.literal('in_progress'),
  v.literal('completed'),
  v.literal('closed'),
  v.literal('backlog'),
  v.literal('pending_user_review'),
  v.literal('backlog_acknowledged')
);

/**
 * Optional typed marker for the origin of a task transition.
 * Audit/diagnostic metadata only — must never gate signal propagation.
 */
export const taskTransitionSourceValidator = v.union(v.literal('task_service'));
export type TaskTransitionSource = typeof taskTransitionSourceValidator.type;

export const machineTaskDeliverySignalValidator = v.object({
  machineId: v.string(),
  chatroomId: v.id('chatroom_rooms'),
  taskId: v.id('chatroom_tasks'),
  targetRole: v.string(),
  taskStatus: machineTaskDeliveryTaskStatusValidator,
  signalKey: v.string(),
  taskUpdatedAt: v.number(),
  source: v.optional(taskTransitionSourceValidator),
});

export type MachineTaskDeliverySignal = typeof machineTaskDeliverySignalValidator.type;

/** Shared composite cursor: `<zero-padded taskUpdatedAt>:<taskId>`. */
export function buildTaskStatusSignalKey(taskUpdatedAt: number, taskId: string): string {
  return `${String(Math.max(0, Math.floor(taskUpdatedAt))).padStart(16, '0')}:${taskId}`;
}
