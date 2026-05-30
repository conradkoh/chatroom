/**
 * Daemon-facing direct-harness command endpoints.
 *
 * Called from the CLI daemon to poll for pending commands and report
 * their completion status.
 */

import { ConvexError, v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { requireDirectHarnessWorkers } from '../../api/directHarnessHelpers.js';
import { requireMachineOwner } from '../../auth/machineAccess.js';
import { mutation, query } from '../../_generated/server.js';

// ─── listPendingCommands ──────────────────────────────────────────────────────

/**
 * List all pending commands for a given machine.
 * The daemon polls this to discover new work.
 */
export const listPendingCommands = query({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
  },
  handler: async (ctx, args) => {
    requireDirectHarnessWorkers();

    await requireMachineOwner(ctx, args.sessionId, args.machineId);

    return await ctx.db
      .query('chatroom_directHarnessCommands')
      .withIndex('by_machineId_status', (q) =>
        q.eq('machineId', args.machineId).eq('status', 'pending')
      )
      .collect();
  },
});

// ─── updateCommandStatus ──────────────────────────────────────────────────────

/**
 * Update the status of a command (inProgress, done, failed).
 * Called by the daemon as it processes each command.
 */
export const updateCommandStatus = mutation({
  args: {
    ...SessionIdArg,
    commandId: v.id('chatroom_directHarnessCommands'),
    status: v.union(
      v.literal('inProgress'),
      v.literal('done'),
      v.literal('failed')
    ),
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requireDirectHarnessWorkers();

    const command = await ctx.db.get('chatroom_directHarnessCommands', args.commandId);
    if (!command) {
      throw new ConvexError({
        code: 'NOT_FOUND',
        message: `Command ${args.commandId} not found`,
      });
    }

    await requireMachineOwner(ctx, args.sessionId, command.machineId);

    const patch: Partial<{
      status: 'inProgress' | 'done' | 'failed';
      completedAt: number;
      errorMessage: string;
    }> = { status: args.status };
    if (args.status === 'done' || args.status === 'failed') {
      patch.completedAt = Date.now();
    }
    if (args.errorMessage !== undefined) {
      patch.errorMessage = args.errorMessage;
    }

    await ctx.db.patch(args.commandId, patch);
  },
});
