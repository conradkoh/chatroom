// fallow-ignore-file complexity

/**
 * Use Case: Fetch one assigned task with full content for daemon action (nudge/inject).
 */

import { isEphemeralAgentRole } from '@workspace/shared/domain/agent-role';

import type { AssignedTaskView, GetAssignedTaskForActionInput } from './assigned-tasks-types';
import type { QueryCtx } from '../../../../convex/_generated/server';
import { WorkspaceTaskAssigneeType } from '../../entities/chatroom-workspace-task-inbox';

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

  const configs = await ctx.db
    .query('chatroom_teamAgentConfigs')
    .withIndex('by_machineId', (q) => q.eq('machineId', input.machineId))
    .filter((q) => q.eq(q.field('chatroomId'), task.chatroomId))
    .collect();
  const config = configs.find(
    (candidate) =>
      candidate.type === 'remote' && candidate.role.toLowerCase() === input.role.toLowerCase()
  );
  if (!config) return null;
  const ephemeral = isEphemeralAgentRole(config.role)
    ? config.agentHarness && config.model && config.workingDir
      ? {
          agentHarness: config.agentHarness,
          model: config.model,
          workingDir: config.workingDir,
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
      role: config.role,
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
