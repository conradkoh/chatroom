import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { NATIVE_WAITING_ACTION } from '../../entities/participant';
import { transitionAgentStatus } from '../agent/transition-agent-status';
import { getParticipantForChatroomRole } from '../machine/assigned-tasks-core';
import { findActiveAssignedTaskForRole } from '../task/find-acknowledged-task-for-role';
import { maybePromoteNextQueuedTask } from '../task/maybe-promote-next-queued-task';
import { transitionTask } from '../task/transition-task';

export type HandleNativeAgentEndResult = {
  needsHandoffReminder: boolean;
  transitionedToWaiting: boolean;
};

async function emitNativeWaitingState(
  ctx: MutationCtx,
  chatroomId: Id<'chatroom_rooms'>,
  role: string,
  now: number
): Promise<void> {
  await ctx.db.insert('chatroom_eventStream', {
    type: 'agent.waiting',
    chatroomId,
    role,
    timestamp: now,
  });
  await transitionAgentStatus(ctx, chatroomId, role, 'agent.waiting');
}

async function patchParticipantNativeWaiting(
  ctx: MutationCtx,
  participant: NonNullable<Awaited<ReturnType<typeof getParticipantForChatroomRole>>>,
  now: number
): Promise<void> {
  await ctx.db.patch('chatroom_participants', participant._id, {
    lastSeenAction: NATIVE_WAITING_ACTION,
    lastSeenAt: now,
  });
}

async function completeActiveTaskForRole(
  ctx: MutationCtx,
  chatroomId: Id<'chatroom_rooms'>,
  role: string
): Promise<boolean> {
  const activeTask = await findActiveAssignedTaskForRole(ctx, { chatroomId, role });
  if (
    !activeTask ||
    (activeTask.status !== 'acknowledged' && activeTask.status !== 'in_progress')
  ) {
    return false;
  }
  await transitionTask(ctx, activeTask._id, 'completed', 'completeTask', undefined, {
    skipAutoPromotion: true,
  });
  return true;
}

/**
 * Idempotent server-side handler for native harness agent_end.
 * When active work remains, signals the CLI to inject a handoff reminder.
 * Otherwise transitions to native waiting.
 */
// fallow-ignore-next-line complexity
export async function handleNativeAgentEnd(
  ctx: MutationCtx,
  args: { chatroomId: Id<'chatroom_rooms'>; role: string }
): Promise<HandleNativeAgentEndResult> {
  const role = args.role.toLowerCase();
  const now = Date.now();
  const participant = await getParticipantForChatroomRole(ctx, args.chatroomId, role);
  const alreadyWaiting = participant?.lastStatus === 'agent.waiting';

  const activeTask = await findActiveAssignedTaskForRole(ctx, {
    chatroomId: args.chatroomId,
    role,
  });
  const hasActiveTask =
    activeTask?.status === 'acknowledged' || activeTask?.status === 'in_progress';

  if (hasActiveTask) {
    await completeActiveTaskForRole(ctx, args.chatroomId, role);
    return { needsHandoffReminder: true, transitionedToWaiting: false };
  }

  const transitionedToWaiting = !alreadyWaiting;
  if (transitionedToWaiting) {
    await emitNativeWaitingState(ctx, args.chatroomId, role, now);
  }
  if (participant) {
    await patchParticipantNativeWaiting(ctx, participant, now);
  }

  await maybePromoteNextQueuedTask(ctx, args.chatroomId, { entryPointRole: role });

  return { needsHandoffReminder: false, transitionedToWaiting };
}
