import { v } from 'convex/values';

/** Optional typed marker for the origin of a task transition. */
export const taskTransitionSourceValidator = v.union(v.literal('task_service'));
export type TaskTransitionSource = typeof taskTransitionSourceValidator.type;

/** Shared composite cursor for chatroom task-status timeline signals. */
export function buildTaskStatusSignalKey(taskUpdatedAt: number, taskId: string): string {
  return `${String(Math.max(0, Math.floor(taskUpdatedAt))).padStart(16, '0')}:${taskId}`;
}
