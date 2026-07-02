import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { NATIVE_WAITING_ACTION } from '../../entities/participant';
import { transitionAgentStatus } from '../agent/transition-agent-status';
import { markChatroomUnread } from '../chatroom/unread-status';
import { findActiveAssignedTaskForRole } from '../task/find-acknowledged-task-for-role';
import { transitionTask } from '../task/transition-task';

export type HandleNativeAgentEndResult = {
  taskCompleted: boolean;
  messageDelivered: boolean;
  transitionedToWaiting: boolean;
};

async function getParticipant(ctx: MutationCtx, chatroomId: Id<'chatroom_rooms'>, role: string) {
  return ctx.db
    .query('chatroom_participants')
    .withIndex('by_chatroom_and_role', (q) => q.eq('chatroomId', chatroomId).eq('role', role))
    .unique();
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
    skipAgentStatusUpdate: true,
  });
  return true;
}

async function deliverBufferedHandoffMessage(
  ctx: MutationCtx,
  args: {
    chatroomId: Id<'chatroom_rooms'>;
    role: string;
    content: string;
    ownerId?: string;
  }
): Promise<void> {
  await ctx.db.insert('chatroom_messages', {
    chatroomId: args.chatroomId,
    senderRole: args.role,
    targetRole: 'user',
    content: args.content,
    type: 'handoff',
  });
  if (args.ownerId) {
    await markChatroomUnread(ctx, args.chatroomId, args.ownerId, true);
  }
}

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

async function maybeDeliverBufferedContent(
  ctx: MutationCtx,
  args: {
    chatroomId: Id<'chatroom_rooms'>;
    role: string;
    content?: string;
    ownerId?: string;
    taskCompleted: boolean;
    alreadyWaiting: boolean;
  }
): Promise<boolean> {
  const content = args.content?.trim();
  if (!content || (!args.taskCompleted && args.alreadyWaiting)) {
    return false;
  }

  await deliverBufferedHandoffMessage(ctx, {
    chatroomId: args.chatroomId,
    role: args.role,
    content,
    ownerId: args.ownerId,
  });
  return true;
}

async function patchParticipantNativeWaiting(
  ctx: MutationCtx,
  participant: NonNullable<Awaited<ReturnType<typeof getParticipant>>>,
  now: number
): Promise<void> {
  await ctx.db.patch('chatroom_participants', participant._id, {
    lastSeenAction: NATIVE_WAITING_ACTION,
    lastSeenAt: now,
  });
}

/**
 * Idempotent server-side handler for native harness agent_end.
 * Completes active work when the agent missed handoff, delivers buffered text,
 * and transitions to native waiting — all driven by task/participant DB state.
 */
export async function handleNativeAgentEnd(
  ctx: MutationCtx,
  args: {
    chatroomId: Id<'chatroom_rooms'>;
    role: string;
    bufferedContent?: string;
    ownerId?: string;
  }
): Promise<HandleNativeAgentEndResult> {
  const role = args.role.toLowerCase();
  const now = Date.now();
  const participant = await getParticipant(ctx, args.chatroomId, role);
  const alreadyWaiting = participant?.lastStatus === 'agent.waiting';

  const taskCompleted = await completeActiveTaskForRole(ctx, args.chatroomId, role);
  const messageDelivered = await maybeDeliverBufferedContent(ctx, {
    chatroomId: args.chatroomId,
    role,
    content: args.bufferedContent,
    ownerId: args.ownerId,
    taskCompleted,
    alreadyWaiting,
  });

  const transitionedToWaiting = !alreadyWaiting;
  if (transitionedToWaiting) {
    await emitNativeWaitingState(ctx, args.chatroomId, role, now);
  }

  if (participant) {
    await patchParticipantNativeWaiting(ctx, participant, now);
  }

  return { taskCompleted, messageDelivered, transitionedToWaiting };
}
