import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { transitionAgentStatus } from '../agent/transition-agent-status';
import { markChatroomUnread } from '../chatroom/unread-status';
import { findActiveAssignedTaskForRole } from '../task/find-acknowledged-task-for-role';
import { transitionTask } from '../task/transition-task';

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
  role: string
): Promise<void> {
  await ctx.db.insert('chatroom_eventStream', {
    type: 'agent.waiting',
    chatroomId,
    role,
    timestamp: Date.now(),
  });
  await transitionAgentStatus(ctx, chatroomId, role, 'agent.waiting');
}

export async function completeNativeTurnWithoutHandoff(
  ctx: MutationCtx,
  args: {
    chatroomId: Id<'chatroom_rooms'>;
    role: string;
    bufferedContent?: string;
    ownerId?: string;
  }
): Promise<{ taskCompleted: boolean; messageDelivered: boolean }> {
  const role = args.role.toLowerCase();
  const taskCompleted = await completeActiveTaskForRole(ctx, args.chatroomId, role);

  const content = args.bufferedContent?.trim();
  let messageDelivered = false;
  if (content) {
    await deliverBufferedHandoffMessage(ctx, {
      chatroomId: args.chatroomId,
      role,
      content,
      ownerId: args.ownerId,
    });
    messageDelivered = true;
  }

  await emitNativeWaitingState(ctx, args.chatroomId, role);

  return { taskCompleted, messageDelivered };
}
