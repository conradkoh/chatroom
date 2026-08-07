/**
 * Daemon-facing command run endpoints.
 *
 * Used by the CLI daemon for log-observer sync and similar machine-scoped reads.
 */

import { v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { mutation, query } from '../_generated/server';
import { requireMachineOwner } from '../auth/cli/machineAccess';
import { handleUpsertRunTail } from '../commands/mutations';
import {
  handleListActionableCommandRuns,
  handleListRunsWithLogObservers,
} from '../commands/queries';

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

/**
 * Daemon-only live tail sync — isolated from chatroom_commandRunsV2 so metadata
 * subscriptions are not invalidated on each flush. Replaces commands.updateRunTailV2.
 */
export const updateRunTail = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    runId: v.id('chatroom_commandRunsV2'),
    tailOutput: v.object({
      compression: v.literal('gzip'),
      content: v.string(),
      byteLength: v.number(),
      totalBytesWritten: v.number(),
      updatedAt: v.number(),
      lineCount: v.number(),
    }),
  },
  handler: async (ctx, args) => {
    await requireMachineOwner(ctx, args.sessionId, args.machineId);
    await handleUpsertRunTail(ctx, args);
  },
});

/**
 * Runs on this machine the daemon must act on imperatively: pending spawns and
 * running runs with a user-requested stop. Subscribed via WebSocket on a
 * dedicated channel, isolated from the multiplexed agent/git event stream so
 * command dispatch is never blocked by slower events or the 60s event TTL.
 */
export const listActionableCommandRuns = query({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
  },
  handler: async (ctx, args) => {
    await requireMachineOwner(ctx, args.sessionId, args.machineId);
    return await handleListActionableCommandRuns(ctx, args);
  },
});
