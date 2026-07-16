import { v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { mutation, query } from './_generated/server';
import { requireMachineWriteAccess } from './auth/cli/machineAccess';
import { agentHarnessValidator } from './schema';

export const getMachineConfigFavorites = query({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    teamRoleKey: v.string(),
  },
  handler: async (ctx, args) => {
    const auth = await requireMachineWriteAccess(ctx, args.sessionId, args.machineId);

    const record = await ctx.db
      .query('chatroom_machineConfigFavorites')
      .withIndex('by_user_machine_teamRole', (q) =>
        q
          .eq('userId', auth.userId)
          .eq('machineId', args.machineId)
          .eq('teamRoleKey', args.teamRoleKey)
      )
      .first();

    return { favorites: record?.favorites ?? [] };
  },
});

export const setMachineConfigFavorites = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    teamRoleKey: v.string(),
    favorites: v.array(
      v.object({
        agentHarness: agentHarnessValidator,
        model: v.string(),
      })
    ),
  },
  handler: async (ctx, args) => {
    const auth = await requireMachineWriteAccess(ctx, args.sessionId, args.machineId);

    const userId = auth.userId;
    const existing = await ctx.db
      .query('chatroom_machineConfigFavorites')
      .withIndex('by_user_machine_teamRole', (q) =>
        q.eq('userId', userId).eq('machineId', args.machineId).eq('teamRoleKey', args.teamRoleKey)
      )
      .first();

    const data = {
      userId,
      machineId: args.machineId,
      teamRoleKey: args.teamRoleKey,
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
