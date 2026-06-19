import type { Doc, Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../../../../convex/_generated/server';

type Ctx = MutationCtx | QueryCtx;

export async function listTeamAgentConfigsForChatroom(
  ctx: Ctx,
  chatroomId: Id<'chatroom_rooms'>
): Promise<Doc<'chatroom_teamAgentConfigs'>[]> {
  return ctx.db
    .query('chatroom_teamAgentConfigs')
    .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
    .collect();
}
