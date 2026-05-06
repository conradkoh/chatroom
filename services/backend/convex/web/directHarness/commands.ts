/**
 * Web-facing direct-harness command endpoints.
 *
 * Called from the web UI to issue commands for the daemon to execute.
 * Commands are stored in chatroom_directHarnessCommands and picked up
 * by the daemon via listPendingCommands.
 *
 * Each command type has an optional field named after the type (e.g.
 * refreshCapabilities → refreshCapabilities payload). This keeps the
 * schema extensible for future command types.
 */

import { v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { requireChatroomAccess } from '../../auth/cliSessionAuth.js';
import { requireDirectHarnessWorkers } from '../../api/directHarnessHelpers.js';
import { mutation } from '../../_generated/server.js';

// ─── refreshCapabilities ──────────────────────────────────────────────────────

/**
 * Request the daemon to re-discover and re-publish its capabilities
 * (agents, providers, models) for the given workspace.
 *
 * Creates a chatroom_directHarnessCommands row that the daemon picks up
 * via listPendingCommands.
 */
export const refreshCapabilities = mutation({
  args: {
    ...SessionIdArg,
    workspaceId: v.id('chatroom_workspaces'),
  },
  handler: async (ctx, args) => {
    requireDirectHarnessWorkers();

    const workspace = await ctx.db.get('chatroom_workspaces', args.workspaceId);
    if (!workspace) {
      throw new Error('Workspace not found');
    }

    // Verify the caller has access to this workspace's chatroom
    const { session } = await requireChatroomAccess(ctx, args.sessionId, workspace.chatroomId);

    // Dedup: if there's already a pending refreshCapabilities for this workspace,
    // don't create another — the daemon will pick it up
    const existing = await ctx.db
      .query('chatroom_directHarnessCommands')
      .withIndex('by_machineId_status', (q) =>
        q.eq('machineId', workspace.machineId).eq('status', 'pending')
      )
      .filter((q) => q.eq(q.field('type'), 'refreshCapabilities'))
      .first();

    if (existing) {
      return;
    }

    await ctx.db.insert('chatroom_directHarnessCommands', {
      machineId: workspace.machineId,
      workspaceId: args.workspaceId,
      type: 'refreshCapabilities',
      refreshCapabilities: { initiatedBy: session.userId },
      status: 'pending',
      createdAt: Date.now(),
    });
  },
});
