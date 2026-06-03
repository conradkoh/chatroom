/**
 * Daemon-facing command run endpoints.
 *
 * Used by the CLI daemon for log-observer sync and similar machine-scoped reads.
 */

import { v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { requireMachineOwner } from '../auth/cli/machineAccess.js';
import { handleListRunsWithLogObservers } from '../commands/queries.js';
import { query } from '../_generated/server.js';

/**
 * Runs on this machine that need live log tail sync (active observers or pending full flush).
 * Daemon subscribes via WebSocket instead of polling the user-facing commands query.
 */
export const listRunsWithLogObservers = query({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
  },
  handler: async (ctx, args) => {
    await requireMachineOwner(ctx, args.sessionId, args.machineId);
    return await handleListRunsWithLogObservers(ctx, args);
  },
});
