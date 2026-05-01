/**
 * Queries for the direct-harness workers feature.
 *
 * All queries require:
 *  1. directHarnessWorkers feature flag enabled
 *  2. Valid SessionIdArg authentication
 *  3. Chatroom membership for the target resource
 */

import { v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { query } from '../../_generated/server.js';
import { requireChatroomAccess } from '../../auth/cliSessionAuth.js';
import { getWorkerWithAccess, requireDirectHarnessWorkers } from './helpers.js';

// ─── getWorker ───────────────────────────────────────────────────────────────

/**
 * Fetch a single worker by ID. Returns null if the worker does not exist or
 * the caller does not have access.
 */
export const getWorker = query({
  args: {
    ...SessionIdArg,
    workerId: v.id('chatroom_workers'),
  },
  handler: async (ctx, args) => {
    requireDirectHarnessWorkers();
    const { worker } = await getWorkerWithAccess(ctx, args.sessionId, args.workerId);
    return worker;
  },
});

// ─── listByChatroom ───────────────────────────────────────────────────────────

/**
 * List all workers for a chatroom, optionally filtered by status.
 * Uses the by_chatroom_status index when status is provided for efficiency.
 */
export const listByChatroom = query({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    status: v.optional(
      v.union(
        v.literal('pending'),
        v.literal('spawning'),
        v.literal('running'),
        v.literal('stopped'),
        v.literal('failed')
      )
    ),
  },
  handler: async (ctx, args) => {
    requireDirectHarnessWorkers();
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    if (args.status !== undefined) {
      return ctx.db
        .query('chatroom_workers')
        .withIndex('by_chatroom_status', (q) =>
          q.eq('chatroomId', args.chatroomId).eq('status', args.status!)
        )
        .collect();
    }

    return ctx.db
      .query('chatroom_workers')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
      .collect();
  },
});

// ─── streamMessages ───────────────────────────────────────────────────────────

/**
 * Return messages for a worker ordered by seq ascending.
 * When afterSeq is provided, only messages with seq > afterSeq are returned
 * (useful for cursor-based streaming without re-fetching already-seen chunks).
 */
export const streamMessages = query({
  args: {
    ...SessionIdArg,
    workerId: v.id('chatroom_workers'),
    afterSeq: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    requireDirectHarnessWorkers();
    await getWorkerWithAccess(ctx, args.sessionId, args.workerId);

    const messages = await ctx.db
      .query('chatroom_workerMessages')
      .withIndex('by_worker_seq', (q) => q.eq('workerId', args.workerId))
      .order('asc')
      .collect();

    if (args.afterSeq !== undefined) {
      return messages.filter((m) => m.seq > args.afterSeq!);
    }

    return messages;
  },
});
