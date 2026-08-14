import type { Doc, Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../../../../convex/_generated/server';
import { filterTeamAgentConfigsForTeam } from '../../../../convex/utils/teamRoleKey';

type Ctx = MutationCtx | QueryCtx;

export async function listTeamAgentConfigsForChatroom(
  ctx: Ctx,
  chatroomId: Id<'chatroom_rooms'>
): Promise<Doc<'chatroom_teamAgentConfigs'>[]> {
  const chatroom = await ctx.db.get('chatroom_rooms', chatroomId);
  const all = await ctx.db
    .query('chatroom_teamAgentConfigs')
    .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
    .collect();
  return filterTeamAgentConfigsForTeam(all, chatroomId, chatroom?.teamId);
}
