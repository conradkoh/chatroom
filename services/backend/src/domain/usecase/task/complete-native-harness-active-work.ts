import { findActiveAssignedTaskForRole } from './find-acknowledged-task-for-role';
import { transitionTask } from './transition-task';
import type { Doc, Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { isNativeHarness } from '../../entities/harness/types';
import { getAgentConfig } from '../agent/get-agent-config';
import { getParticipantForChatroomRole } from '../machine/assigned-tasks-core';

// fallow-ignore-next-line complexity
function isActiveNativeTaskForRole(
  task: Doc<'chatroom_tasks'> | null,
  chatroomId: Id<'chatroom_rooms'>,
  role: string
): task is Doc<'chatroom_tasks'> {
  if (!task) return false;
  if (task.chatroomId !== chatroomId) return false;
  if (task.assignedTo?.toLowerCase() !== role.toLowerCase()) return false;
  return task.status === 'acknowledged' || task.status === 'in_progress';
}

async function resolveCorrelatedActiveTask(
  ctx: MutationCtx,
  chatroomId: Id<'chatroom_rooms'>,
  role: string,
  taskId?: Id<'chatroom_tasks'>
) {
  if (taskId) {
    return ctx.db.get('chatroom_tasks', taskId);
  }

  const participant = await getParticipantForChatroomRole(ctx, chatroomId, role);
  if (participant?.lastInFlightTaskId) {
    return ctx.db.get('chatroom_tasks', participant.lastInFlightTaskId);
  }

  return findActiveAssignedTaskForRole(ctx, { chatroomId, role });
}

/**
 * Completes the active (acknowledged or in_progress) task for a native harness role.
 * Single entry point for agent_end recovery completion.
 */
export async function completeNativeHarnessActiveWork(
  ctx: MutationCtx,
  chatroomId: Id<'chatroom_rooms'>,
  role: string,
  opts?: { taskId?: Id<'chatroom_tasks'> }
): Promise<Id<'chatroom_tasks'> | null> {
  const activeTask = await resolveCorrelatedActiveTask(ctx, chatroomId, role, opts?.taskId);
  if (!isActiveNativeTaskForRole(activeTask, chatroomId, role)) {
    return null;
  }

  await transitionTask(ctx, activeTask._id, 'completed', 'completeTask', undefined, {
    skipAutoPromotion: true,
  });
  return activeTask._id;
}

/**
 * Skip force-completing a pending task on handoff-to-user when it was promoted after
 * agent_end recovery for a different (already completed) in-flight task.
 */
// fallow-ignore-next-line complexity
export async function shouldSkipHandoffPendingTask(
  ctx: MutationCtx,
  chatroomId: Id<'chatroom_rooms'>,
  senderRole: string,
  pendingTaskId: Id<'chatroom_tasks'>
): Promise<boolean> {
  const participant = await getParticipantForChatroomRole(ctx, chatroomId, senderRole);
  const agentConfigResult = await getAgentConfig(ctx, { chatroomId, role: senderRole });
  if (!agentConfigResult.found || !isNativeHarness(agentConfigResult.config.agentHarness)) {
    return false;
  }

  const inFlightTaskId = participant?.lastInFlightTaskId;
  if (!inFlightTaskId || pendingTaskId === inFlightTaskId) {
    return false;
  }

  const inFlightTask = await ctx.db.get('chatroom_tasks', inFlightTaskId);
  return inFlightTask?.status === 'completed';
}
