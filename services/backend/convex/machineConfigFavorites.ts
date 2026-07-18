import { v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { mutation, query } from './_generated/server';
import { requireMachineWriteAccess } from './auth/cli/machineAccess';
import { agentHarnessValidator } from './schema';
import {
  isLegacyMachineFavoriteScopeKey,
  normalizeMachineFavoriteScopeKey,
} from './utils/machineFavoriteScopeKey';

export const getMachineConfigFavorites = query({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    teamRoleKey: v.string(),
  },
  handler: async (ctx, args) => {
    const auth = await requireMachineWriteAccess(ctx, args.sessionId, args.machineId);
    const scopeKey = normalizeMachineFavoriteScopeKey(args.teamRoleKey);

    const record = await ctx.db
      .query('chatroom_machineConfigFavorites')
      .withIndex('by_user_machine_teamRole', (q) =>
        q.eq('userId', auth.userId).eq('machineId', args.machineId).eq('teamRoleKey', scopeKey)
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
    const scopeKey = normalizeMachineFavoriteScopeKey(args.teamRoleKey);

    const existing = await ctx.db
      .query('chatroom_machineConfigFavorites')
      .withIndex('by_user_machine_teamRole', (q) =>
        q.eq('userId', userId).eq('machineId', args.machineId).eq('teamRoleKey', scopeKey)
      )
      .first();

    const data = {
      userId,
      machineId: args.machineId,
      teamRoleKey: scopeKey,
      favorites: args.favorites,
      updatedAt: Date.now(),
    };

    if (existing) {
      await ctx.db.patch('chatroom_machineConfigFavorites', existing._id, data);
    } else {
      await ctx.db.insert('chatroom_machineConfigFavorites', data);
    }

    // Clean up legacy rows for the same normalized scope
    const allForMachine = await ctx.db
      .query('chatroom_machineConfigFavorites')
      .withIndex('by_user_machine_teamRole', (q) =>
        q.eq('userId', userId).eq('machineId', args.machineId)
      )
      .collect();
    for (const row of allForMachine) {
      if (existing && row._id === existing._id) continue;
      if (
        isLegacyMachineFavoriteScopeKey(row.teamRoleKey) &&
        normalizeMachineFavoriteScopeKey(row.teamRoleKey) === scopeKey
      ) {
        await ctx.db.delete('chatroom_machineConfigFavorites', row._id);
      }
    }

    return { success: true };
  },
});
