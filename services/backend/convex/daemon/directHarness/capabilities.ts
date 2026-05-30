/**
 * Daemon-facing harness capability endpoints.
 *
 * Called from the CLI daemon to publish machine capabilities on boot.
 */

import { v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { requireDirectHarnessWorkers } from '../../api/directHarnessHelpers.js';
import { requireMachineOwner } from '../../auth/cli/machineAccess.js';
import { mutation } from '../../_generated/server.js';

// ─── publishMachineCapabilities ───────────────────────────────────────────────

export const publishMachineCapabilities = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    workspaces: v.array(
      v.object({
        workspaceId: v.string(),
        cwd: v.string(),
        name: v.string(),
        harnesses: v.array(
          v.object({
            name: v.string(),
            displayName: v.string(),
            agents: v.array(
              v.object({
                name: v.string(),
                mode: v.union(v.literal('subagent'), v.literal('primary'), v.literal('all')),
                model: v.optional(v.object({ providerID: v.string(), modelID: v.string() })),
                description: v.optional(v.string()),
              })
            ),
            providers: v.array(
              v.object({
                providerID: v.string(),
                name: v.string(),
                models: v.array(v.object({ modelID: v.string(), name: v.string() })),
              })
            ),
            configSchema: v.optional(v.any()),
          })
        ),
      })
    ),
  },
  handler: async (ctx, args) => {
    requireDirectHarnessWorkers();

    await requireMachineOwner(ctx, args.sessionId, args.machineId);

    const existing = await ctx.db
      .query('chatroom_machineRegistry')
      .withIndex('by_machineId', (q) => q.eq('machineId', args.machineId))
      .first();

    const entry = {
      machineId: args.machineId,
      lastSeenAt: Date.now(),
      workspaces: args.workspaces,
    };

    if (existing) {
      await ctx.db.patch(existing._id, entry);
    } else {
      await ctx.db.insert('chatroom_machineRegistry', entry);
    }
  },
});
