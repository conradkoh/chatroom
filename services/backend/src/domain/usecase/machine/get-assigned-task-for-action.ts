// fallow-ignore-file complexity

/**
 * Use Case: Fetch one assigned task with full content for daemon action (nudge/inject).
 */

import type { AssignedTaskView, GetAssignedTaskForActionInput } from './assigned-tasks-types';
import type { QueryCtx } from '../../../../convex/_generated/server';
import { WorkspaceTaskAssigneeType } from '../../entities/chatroom-workspace-task-inbox';
import { getLastSentLaunchRequestForRole } from '../agent/get-last-sent-launch-request';
import { isEphemeralRoleInChatroom } from '../team/resolve-chatroom-team';

export async function getAssignedTaskForAction(
  ctx: QueryCtx,
  input: GetAssignedTaskForActionInput
): Promise<AssignedTaskView | null> {
  const machine = await ctx.db
    .query('chatroom_machines')
    .withIndex('by_machineId', (q) => q.eq('machineId', input.machineId))
    .first();
  if (!machine || machine.userId !== input.userId) return null;

  const task = await ctx.db.get('chatroom_tasks', input.taskId);
  if (
    !task ||
    (task.status !== 'pending' && task.status !== 'acknowledged' && task.status !== 'in_progress')
  ) {
    return null;
  }
  if (task.assignedTo?.toLowerCase() !== input.role.toLowerCase()) return null;

  const launchRequest = await getLastSentLaunchRequestForRole(ctx, {
    chatroomId: task.chatroomId,
    role: input.role,
  });
  if (!launchRequest || launchRequest.agentType !== 'remote') return null;
  if (launchRequest.machineId !== input.machineId) return null;

  const isEphemeral = await isEphemeralRoleInChatroom(ctx, task.chatroomId, launchRequest.role);
  const ephemeral = isEphemeral
    ? launchRequest.agentHarness && launchRequest.model && launchRequest.workingDir
      ? {
          agentHarness: launchRequest.agentHarness,
          model: launchRequest.model,
          workingDir: launchRequest.workingDir,
        }
      : null
    : undefined;
  if (ephemeral === null) return null;

  return {
    taskId: task._id,
    chatroomId: task.chatroomId,
    status: task.status,
    assignedTo: task.assignedTo,
    updatedAt: task.updatedAt,
    createdAt: task.createdAt,
    agentConfig: {
      role: launchRequest.role,
      machineId: input.machineId,
    },
    assignee: ephemeral
      ? { type: WorkspaceTaskAssigneeType.Ephemeral, ephemeral }
      : { type: WorkspaceTaskAssigneeType.Permanent },
    taskContent: task.content,
    taskEnvelope: task.taskEnvelope,
    startInNewSession: task.startInNewSession,
  };
}
