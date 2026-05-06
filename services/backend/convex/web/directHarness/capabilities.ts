/**
 * Web-facing harness capability endpoints.
 *
 * Called from the web UI to list available capabilities for a workspace.
 */

import { v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { requireDirectHarnessWorkers } from '../../api/directHarnessHelpers.js';
import { query } from '../../_generated/server.js';

// ─── listForWorkspace ─────────────────────────────────────────────────────────

export const listForWorkspace = query({
  args: {
    ...SessionIdArg,
    workspaceId: v.id('chatroom_workspaces'),
  },
  handler: async (ctx, args) => {
    requireDirectHarnessWorkers();

    const workspace = await ctx.db.get('chatroom_workspaces', args.workspaceId);
    if (!workspace) return { harnesses: [] };

    // Check machine registry for rich capability data
    const registryEntry = await ctx.db
      .query('chatroom_machineRegistry')
      .withIndex('by_machineId', (q) => q.eq('machineId', workspace.machineId))
      .first();

    if (registryEntry) {
      const wsEntry = registryEntry.workspaces.find((w) => w.workspaceId === args.workspaceId);
      if (wsEntry && wsEntry.harnesses && wsEntry.harnesses.length > 0) {
        return { harnesses: wsEntry.harnesses };
      }
    }

    return { harnesses: [] };
  },
});
