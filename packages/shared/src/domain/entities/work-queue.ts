/**
 * Classifies every persisted task state by whether it occupies the room's active
 * queue slot. Agent readiness is independent. Legacy backlog states never
 * occupy this slot.
 */
export const TASK_QUEUE_ACTIVITY_BY_STATUS = {
  pending: true,
  acknowledged: true,
  in_progress: true,
  completed: false,
  closed: false,
  backlog: false,
  pending_user_review: false,
  backlog_acknowledged: false,
} as const;

export type QueueTaskStatus = keyof typeof TASK_QUEUE_ACTIVITY_BY_STATUS;

export type ActiveQueueTaskStatus = {
  [Status in QueueTaskStatus]: (typeof TASK_QUEUE_ACTIVITY_BY_STATUS)[Status] extends true
    ? Status
    : never;
}[QueueTaskStatus];

export type ActiveWorkQueueTaskCounts = Readonly<Record<ActiveQueueTaskStatus, number>>;

/** Presence of active work and staged user messages in a single chatroom. */
export interface WorkQueueOccupancy {
  readonly hasActiveTask: boolean;
  readonly hasQueuedMessages: boolean;
}

/** All active queue statuses derived from the policy, rather than a separate hand-maintained list. */
export const ACTIVE_QUEUE_TASK_STATUSES: readonly ActiveQueueTaskStatus[] = (
  Object.keys(TASK_QUEUE_ACTIVITY_BY_STATUS) as QueueTaskStatus[]
).filter((status): status is ActiveQueueTaskStatus => TASK_QUEUE_ACTIVITY_BY_STATUS[status]);

/** A count snapshot must classify/count every active status; completed/legacy work is irrelevant. */
export function hasActiveWorkQueueTask(counts: ActiveWorkQueueTaskCounts): boolean {
  return ACTIVE_QUEUE_TASK_STATUSES.some((status) => counts[status] > 0);
}

/**
 * Explicit promotion is available only for an occupied staged queue with no
 * active task. This is user recovery eligibility, not an automatic agent-start
 * or auto-promotion trigger.
 */
export function needsManualQueuePromotion(occupancy: WorkQueueOccupancy): boolean {
  return !occupancy.hasActiveTask && occupancy.hasQueuedMessages;
}
