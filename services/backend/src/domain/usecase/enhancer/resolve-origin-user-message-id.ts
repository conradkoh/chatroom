import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';

export async function walkToUserMessageId(
  ctx: MutationCtx,
  messageId: Id<'chatroom_messages'>
): Promise<Id<'chatroom_messages'> | null> {
  const msg = await ctx.db.get('chatroom_messages', messageId);
  if (!msg) return null;
  if (msg.senderRole.toLowerCase() === 'user') return msg._id;
  if ((msg as { taskOriginMessageId?: Id<'chatroom_messages'> | undefined }).taskOriginMessageId) {
    return walkToUserMessageId(
      ctx,
      (msg as { taskOriginMessageId: Id<'chatroom_messages'> }).taskOriginMessageId
    );
  }
  return null;
}

export async function resolveOriginUserMessageIdForPlannerCheckIn(
  ctx: MutationCtx,
  chatroomId: Id<'chatroom_rooms'>
): Promise<Id<'chatroom_messages'> | null> {
  const [inProgress, acknowledged] = await Promise.all([
    ctx.db
      .query('chatroom_tasks')
      .withIndex('by_chatroom_status', (q) =>
        q.eq('chatroomId', chatroomId).eq('status', 'in_progress')
      )
      .collect(),
    ctx.db
      .query('chatroom_tasks')
      .withIndex('by_chatroom_status', (q) =>
        q.eq('chatroomId', chatroomId).eq('status', 'acknowledged')
      )
      .collect(),
  ]);

  const plannerTasks = [...inProgress, ...acknowledged].filter(
    (t) => t.assignedTo?.toLowerCase() === 'planner'
  );

  for (const task of plannerTasks) {
    if (!task.sourceMessageId) continue;
    const originId = await walkToUserMessageId(ctx, task.sourceMessageId);
    if (originId) return originId;
  }
  return null;
}
