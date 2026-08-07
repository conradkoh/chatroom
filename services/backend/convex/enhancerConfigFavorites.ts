import { v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { mutation, query } from './_generated/server';
import { requireMachineWriteAccess } from './auth/cli/machineAccess';
import { agentHarnessValidator } from './schema';

const enhancerFavoriteEntryValidator = v.object({
  targetId: v.literal('handoff:planner-to-builder'),
  agentHarness: agentHarnessValidator,
  model: v.string(),
});

export const getEnhancerConfigFavorites = query({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
  },
  handler: async (ctx, args) => {
    const auth = await requireMachineWriteAccess(ctx, args.sessionId, args.machineId);

    const record = await ctx.db
      .query('chatroom_enhancerConfigFavorites')
      .withIndex('by_user_machine', (q) =>
        q.eq('userId', auth.userId).eq('machineId', args.machineId)
      )
      .first();

    return { favorites: record?.favorites ?? [] };
  },
});

export const setEnhancerConfigFavorites = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    favorites: v.array(enhancerFavoriteEntryValidator),
  },
  handler: async (ctx, args) => {
    const auth = await requireMachineWriteAccess(ctx, args.sessionId, args.machineId);

    const existing = await ctx.db
      .query('chatroom_enhancerConfigFavorites')
      .withIndex('by_user_machine', (q) =>
        q.eq('userId', auth.userId).eq('machineId', args.machineId)
      )
      .first();

    const data = {
      userId: auth.userId,
      machineId: args.machineId,
      favorites: args.favorites,
      updatedAt: Date.now(),
    };

    if (existing) {
      await ctx.db.patch('chatroom_enhancerConfigFavorites', existing._id, data);
    } else {
      await ctx.db.insert('chatroom_enhancerConfigFavorites', data);
    }

    return { success: true };
  },
});
