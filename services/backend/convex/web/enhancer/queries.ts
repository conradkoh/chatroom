import { v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';
import { query } from '../../_generated/server';
import { requireChatroomAccess } from '../../auth/chatroomAccess';

export const getConfig = query({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
  },
  handler: async (ctx, args) => {
    const { session } = await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);
    const config = await ctx.db
      .query('chatroom_enhancerConfigs')
      .withIndex('by_chatroom_user', (q) =>
        q.eq('chatroomId', args.chatroomId).eq('userId', session.userId)
      )
      .unique();
    if (!config) return null;
    return {
      enabled: config.enabled,
      targetId: config.targetId,
      agentHarness: config.agentHarness,
      model: config.model,
      machineId: config.machineId,
      updatedAt: config.updatedAt,
    };
  },
});
