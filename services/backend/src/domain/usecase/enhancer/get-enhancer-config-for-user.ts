import type { Doc, Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../../../../convex/_generated/server';

type DbCtx = QueryCtx | MutationCtx;

export async function getEnhancerConfigForUser(
  ctx: DbCtx,
  chatroomId: Id<'chatroom_rooms'>,
  userId: Id<'users'>
): Promise<Doc<'chatroom_enhancerConfigs'> | null> {
  const config = await ctx.db
    .query('chatroom_enhancerConfigs')
    .withIndex('by_chatroom_user', (q) => q.eq('chatroomId', chatroomId).eq('userId', userId))
    .unique();
  return config ?? null;
}
