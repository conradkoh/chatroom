import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { NATIVE_WAITING_ACTION } from '../../entities/participant';
import { transitionAgentStatus } from '../agent/transition-agent-status';
import { getParticipantForChatroomRole } from '../machine/assigned-tasks-core';
import { findNativeHarnessInProgressWork } from '../task/find-native-harness-in-progress-work';

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

/**
 * Idempotent server-side handler for native harness agent_end.
 * When in_progress work remains, signals the CLI to inject a handoff reminder.
 * Task completion and queue promotion happen on handoff-to-user, not here.
 * Otherwise transitions to native waiting.
 */
// fallow-ignore-next-line complexity
export async function handleNativeAgentEnd(
  ctx: MutationCtx,
  args: { chatroomId: Id<'chatroom_rooms'>; role: string; taskId?: Id<'chatroom_tasks'> }
): Promise<HandleNativeAgentEndResult> {
  const role = args.role.toLowerCase();
  const now = Date.now();
  const participant = await getParticipantForChatroomRole(ctx, args.chatroomId, role);
  const alreadyWaiting = participant?.lastStatus === 'agent.waiting';

  const inProgressTaskId = await findNativeHarnessInProgressWork(ctx, args.chatroomId, role, {
    taskId: args.taskId,
  });
  if (inProgressTaskId) {
    await ctx.db.insert('chatroom_eventStream', {
      type: 'agent.awaitingHandoff',
      chatroomId: args.chatroomId,
      role,
      timestamp: now,
    });
    await transitionAgentStatus(ctx, args.chatroomId, role, 'agent.awaitingHandoff');
    return { needsHandoffReminder: true, transitionedToWaiting: false };
  }

  const transitionedToWaiting = !alreadyWaiting;
  if (transitionedToWaiting) {
    await emitNativeWaitingState(ctx, args.chatroomId, role, now);
  }
  if (participant) {
    await patchParticipantNativeWaiting(ctx, participant, now);
  }

  return { needsHandoffReminder: false, transitionedToWaiting };
}
