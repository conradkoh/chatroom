import type { Doc, Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { getAndIncrementQueuePosition } from '../../../../convex/lib/chatroomUtils';

// fallow-ignore-next-line complexity
export async function reserveFrontQueuePosition(
  ctx: MutationCtx,
  chatroomId: Id<'chatroom_rooms'>,
  chatroom: Doc<'chatroom_rooms'>
): Promise<number> {
  const front = await ctx.db
    .query('chatroom_messageQueue')
    .withIndex('by_chatroom_queue', (q) => q.eq('chatroomId', chatroomId))
    .order('asc')
    .first();
  if (!front) return getAndIncrementQueuePosition(ctx, chatroom);
  if (front.queuePosition > 0) {
    const reserved = front.queuePosition - 1;
    const minCounter = front.queuePosition + 1;
    if (chatroom.nextQueuePosition === undefined || chatroom.nextQueuePosition < minCounter) {
      await ctx.db.patch('chatroom_rooms', chatroomId, { nextQueuePosition: minCounter });
    }
    return reserved;
  }
  const all = await ctx.db
    .query('chatroom_messageQueue')
    .withIndex('by_chatroom_queue', (q) => q.eq('chatroomId', chatroomId))
    .order('asc')
    .collect();
  for (let i = 0; i < all.length; i++) {
    const item = all[i];
    if (item) await ctx.db.patch('chatroom_messageQueue', item._id, { queuePosition: i + 1 });
  }
  await ctx.db.patch('chatroom_rooms', chatroomId, { nextQueuePosition: all.length + 1 });
  return 0;
}
