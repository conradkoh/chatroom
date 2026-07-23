import { ConvexError, v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';
import { agentHarnessValidator } from '../../schema';
import { mutation } from '../../_generated/server';
import { requireChatroomAccess } from '../../auth/chatroomAccess';

export const upsertConfig = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    enabled: v.boolean(),
    targetId: v.literal('handoff:planner-to-builder'),
    agentHarness: agentHarnessValidator,
    model: v.string(),
    machineId: v.string(),
  },
  handler: async (ctx, args) => {
    const { session } = await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);
    if (!args.model.trim()) {
      throw new ConvexError({ code: 'INVALID_MODEL', message: 'model must not be empty' });
    }
    if (!args.machineId.trim()) {
      throw new ConvexError({ code: 'INVALID_MACHINE', message: 'machineId must not be empty' });
    }

    const existing = await ctx.db
      .query('chatroom_enhancerConfigs')
      .withIndex('by_chatroom_user', (q) =>
        q.eq('chatroomId', args.chatroomId).eq('userId', session.userId)
      )
      .unique();

    const now = Date.now();
    const doc = {
      chatroomId: args.chatroomId,
      userId: session.userId,
      enabled: args.enabled,
      targetId: args.targetId,
      agentHarness: args.agentHarness,
      model: args.model.trim(),
      machineId: args.machineId.trim(),
      updatedAt: now,
    };

    if (existing) {
      await ctx.db.patch(existing._id, doc);
      return { configId: existing._id };
    }
    const configId = await ctx.db.insert('chatroom_enhancerConfigs', doc);
    return { configId };
  },
});

export const disableConfig = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
  },
  handler: async (ctx, args) => {
    const { session } = await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);
    const existing = await ctx.db
      .query('chatroom_enhancerConfigs')
      .withIndex('by_chatroom_user', (q) =>
        q.eq('chatroomId', args.chatroomId).eq('userId', session.userId)
      )
      .unique();
    if (!existing) return { removed: false };
    await ctx.db.delete(existing._id);
    return { removed: true };
  },
});
