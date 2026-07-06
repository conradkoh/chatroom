import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { NATIVE_WAITING_ACTION } from '../../entities/participant';
import { transitionAgentStatus } from '../agent/transition-agent-status';
import { getParticipantForChatroomRole } from '../machine/assigned-tasks-core';
import { completeNativeHarnessActiveWork } from '../task/complete-native-harness-active-work';
import { maybePromoteNextQueuedTask } from '../task/maybe-promote-next-queued-task';

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
 * When active work remains, signals the CLI to inject a handoff reminder.
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

  const completedTaskId = await completeNativeHarnessActiveWork(ctx, args.chatroomId, role, {
    taskId: args.taskId,
  });
  if (completedTaskId) {
    return { needsHandoffReminder: true, transitionedToWaiting: false };
  }

  const transitionedToWaiting = !alreadyWaiting;
  if (transitionedToWaiting) {
    await emitNativeWaitingState(ctx, args.chatroomId, role, now);
  }
  if (participant) {
    await patchParticipantNativeWaiting(ctx, participant, now);
  }

  // A second agent_end can fire after active work was completed but before handoff-to-user
  // runs. Idle-path promotion here would create a pending task that handoff Step 1 then
  // force-completes without the agent ever receiving it. Defer promotion to handoff Step 6.
  const awaitingHandoffAfterTaskComplete = participant?.lastStatus === 'task.completed';
  if (!awaitingHandoffAfterTaskComplete) {
    await maybePromoteNextQueuedTask(ctx, args.chatroomId, { entryPointRole: role });
  }

  return { needsHandoffReminder: false, transitionedToWaiting };
}
