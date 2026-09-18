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
