/**
 * Domain Model: Task
 *
 * Shared task-related constants and helpers. The canonical TaskStatus type
 * lives in convex/lib/taskStateMachine.ts — this module provides derived
 * constants that multiple consumers need.
 */

import {
  ACTIVE_QUEUE_TASK_STATUSES,
  TASK_QUEUE_ACTIVITY_BY_STATUS,
} from '@workspace/shared/domain/entities/work-queue';

import { getTeamEntryPoint } from './team';
import type { Doc } from '../../../convex/_generated/dataModel';
import type { TaskStatus } from '../../../convex/lib/taskStateMachine';

const queueActivityByStatus = TASK_QUEUE_ACTIVITY_BY_STATUS satisfies Readonly<
  Record<Doc<'chatroom_tasks'>['status'] | TaskStatus, boolean>
>;

/**
 * Task statuses that indicate an agent should be actively running.
 * Used by on-agent-exited, transition-task, and create-task for
 * active-task queries and guards.
 */
export const ACTIVE_TASK_STATUSES: ReadonlySet<TaskStatus> = new Set(
  ACTIVE_QUEUE_TASK_STATUSES.filter((status) => queueActivityByStatus[status])
);

/**
 * Task statuses that free the queue slot and trigger auto-promotion
 * of the next queued message.
 */
export const TERMINAL_TASK_STATUSES: ReadonlySet<TaskStatus> = new Set(['completed']);

/**
 * Resolves the responsible role for a task.
 *
 * Priority:
 *   1. Explicitly assigned role (task.assignedTo)
 *   2. Team entry point (first role or configured entry point)
 *   3. 'unknown' fallback
 *
 * Used when emitting task events (task.activated, task.completed) where
 * the role is required but may not be set on the task itself.
 */
export function resolveTaskRole(
  assignedTo: string | undefined | null,
  chatroom: {
    teamEntryPoint?: string | null | undefined;
    teamRoles?: string[] | null | undefined;
  } | null
): string {
  if (assignedTo) return assignedTo;
  return getTeamEntryPoint(chatroom ?? {}) ?? 'unknown';
}
