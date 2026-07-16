import { ConvexError, v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { mutation, query } from './_generated/server';
import { agentHarnessValidator } from './schema';

export const getMachineConfigFavorites = query({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
  },
  handler: async (ctx, args) => {
    const session = await ctx.auth.getUserIdentity();
    if (!session) throw new ConvexError({ code: 'AUTH_FAILED', message: 'Not authenticated' });

    const record = await ctx.db
      .query('chatroom_machineConfigFavorites')
      .withIndex('by_user_machine', (q) =>
        q.eq('userId', session.subject as any).eq('machineId', args.machineId)
      )
      .first();

    return { favorites: record?.favorites ?? [] };
  },
});

export const setMachineConfigFavorites = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    favorites: v.array(
      v.object({
        agentHarness: agentHarnessValidator,
        model: v.string(),
      })
    ),
  },
  handler: async (ctx, args) => {
    const session = await ctx.auth.getUserIdentity();
    if (!session) throw new ConvexError({ code: 'AUTH_FAILED', message: 'Not authenticated' });

    const userId = session.subject as any;
    const existing = await ctx.db
      .query('chatroom_machineConfigFavorites')
      .withIndex('by_user_machine', (q) => q.eq('userId', userId).eq('machineId', args.machineId))
      .first();

    const data = {
      userId,
      machineId: args.machineId,
      favorites: args.favorites,
      updatedAt: Date.now(),
    };

    if (existing) {
      await ctx.db.patch('chatroom_machineConfigFavorites', existing._id, data);
    } else {
      await ctx.db.insert('chatroom_machineConfigFavorites', data);
    }

    return { success: true };
  },
});
