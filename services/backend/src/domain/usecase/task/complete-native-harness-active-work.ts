import { findActiveAssignedTaskForRole } from './find-acknowledged-task-for-role';
import { transitionTask } from './transition-task';
import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { isNativeHarness } from '../../entities/harness/types';
import { getAgentConfig } from '../agent/get-agent-config';
import { getParticipantForChatroomRole } from '../machine/assigned-tasks-core';

/**
 * Completes the active (acknowledged or in_progress) task for a native harness role.
 * Single entry point for agent_end recovery completion.
 */
export async function completeNativeHarnessActiveWork(
  ctx: MutationCtx,
  chatroomId: Id<'chatroom_rooms'>,
  role: string
): Promise<Id<'chatroom_tasks'> | null> {
  const activeTask = await findActiveAssignedTaskForRole(ctx, { chatroomId, role });
  if (
    !activeTask ||
    (activeTask.status !== 'acknowledged' && activeTask.status !== 'in_progress')
  ) {
    return null;
  }
  await transitionTask(ctx, activeTask._id, 'completed', 'completeTask', undefined, {
    skipAutoPromotion: true,
  });
  return activeTask._id;
}

/**
 * After agent_end recovery, participant lastStatus is task.completed and any pending
 * task for the sender should be delivered to the agent — not force-completed in handoff.
 */
export async function shouldSkipNativeHandoffPendingCompletion(
  ctx: MutationCtx,
  chatroomId: Id<'chatroom_rooms'>,
  senderRole: string
): Promise<boolean> {
  const participant = await getParticipantForChatroomRole(ctx, chatroomId, senderRole);
  if (participant?.lastStatus !== 'task.completed') {
    return false;
  }
  const agentConfigResult = await getAgentConfig(ctx, { chatroomId, role: senderRole });
  return agentConfigResult.found && isNativeHarness(agentConfigResult.config.agentHarness);
}
