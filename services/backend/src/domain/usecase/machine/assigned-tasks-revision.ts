/**
 * Revision / presence keys for machine assigned-task snapshot rows.
 */

import type { Id } from '../../../../convex/_generated/dataModel';

export function buildAssignedTaskRevisionKey(params: {
  taskUpdatedAt: number;
  configUpdatedAt: number;
  lastSeenAction: string;
  lastStatus: string;
  taskId: Id<'chatroom_tasks'>;
  role: string;
}): string {
  const paddedTask = String(params.taskUpdatedAt).padStart(16, '0');
  const paddedConfig = String(params.configUpdatedAt).padStart(16, '0');
  return `${paddedTask}:${paddedConfig}:${params.lastSeenAction}:${params.lastStatus}:${params.taskId}:${params.role}`;
}

export function buildAssignedTaskPresenceKey(params: {
  presenceUpdatedAt: number;
  taskId: Id<'chatroom_tasks'>;
  role: string;
}): string {
  const paddedPresence = String(params.presenceUpdatedAt).padStart(16, '0');
  return `${paddedPresence}:${params.taskId}:${params.role}`;
}

export function presenceKeyAfterTimestamp(presenceUpdatedAt: number): string {
  const paddedPresence = String(presenceUpdatedAt).padStart(16, '0');
  return `${paddedPresence}:~:~`;
}

export function primaryAssignedTaskSignalType(
  taskUpdatedAt: number,
  configUpdatedAt: number
): 'task' | 'agent_config' {
  return taskUpdatedAt >= configUpdatedAt ? 'task' : 'agent_config';
}
