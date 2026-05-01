/**
 * Mutations for the direct-harness workers feature.
 *
 * All mutations require:
 *  1. directHarnessWorkers feature flag enabled
 *  2. Valid SessionIdArg authentication
 *  3. Chatroom membership for the target chatroom
 */

import { ConvexError, v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { mutation } from '../../_generated/server.js';
import { requireChatroomAccess } from '../../auth/cliSessionAuth.js';
import { getWorkerWithAccess, requireDirectHarnessWorkers } from './helpers.js';

// ─── createWorker ────────────────────────────────────────────────────────────

/**
 * Create a new worker for a chatroom. The backend issues the workerId (_id).
 * Returns { workerId } so the caller can associate a harness session later.
 */
export const createWorker = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    harnessName: v.string(),
  },
  handler: async (ctx, args) => {
    requireDirectHarnessWorkers();
    const { session } = await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    const now = Date.now();
    const workerId = await ctx.db.insert('chatroom_workers', {
      chatroomId: args.chatroomId,
      harnessName: args.harnessName,
      harnessSessionId: undefined,
      status: 'pending',
      createdBy: session.userId,
      createdAt: now,
      updatedAt: now,
    });

    return { workerId };
  },
});

// ─── associateHarnessSession ─────────────────────────────────────────────────

/**
 * Associate a harness session ID with a worker after the process has spawned.
 * Idempotent: if the same harnessSessionId is already set, returns without writing.
 * Throws if a different harnessSessionId is already associated.
 */
export const associateHarnessSession = mutation({
  args: {
    ...SessionIdArg,
    workerId: v.id('chatroom_workers'),
    harnessSessionId: v.string(),
  },
  handler: async (ctx, args) => {
    requireDirectHarnessWorkers();
    const { worker } = await getWorkerWithAccess(ctx, args.sessionId, args.workerId);

    // Idempotent: same session already associated
    if (worker.harnessSessionId === args.harnessSessionId) {
      return;
    }

    // Conflict: different session already associated
    if (worker.harnessSessionId !== undefined && worker.harnessSessionId !== null) {
      throw new ConvexError(
        `Worker ${args.workerId} already has a different harnessSessionId: ${worker.harnessSessionId}`
      );
    }

    await ctx.db.patch(args.workerId, {
      harnessSessionId: args.harnessSessionId,
      status: 'running',
      updatedAt: Date.now(),
    });
  },
});

// ─── appendMessages ──────────────────────────────────────────────────────────

/**
 * Append output chunks from a harness session to the worker's message stream.
 * Idempotent on (workerId, seq) — duplicate chunks are silently skipped.
 * Returns { inserted, skipped } counts.
 */
export const appendMessages = mutation({
  args: {
    ...SessionIdArg,
    workerId: v.id('chatroom_workers'),
    chunks: v.array(
      v.object({
        seq: v.number(),
        content: v.string(),
        timestamp: v.number(),
      })
    ),
  },
  handler: async (ctx, args) => {
    requireDirectHarnessWorkers();
    await getWorkerWithAccess(ctx, args.sessionId, args.workerId);

    let inserted = 0;
    let skipped = 0;

    for (const chunk of args.chunks) {
      // Idempotency check: skip if (workerId, seq) already exists
      const existing = await ctx.db
        .query('chatroom_workerMessages')
        .withIndex('by_worker_seq', (q) =>
          q.eq('workerId', args.workerId).eq('seq', chunk.seq)
        )
        .unique();

      if (existing) {
        skipped++;
        continue;
      }

      await ctx.db.insert('chatroom_workerMessages', {
        workerId: args.workerId,
        seq: chunk.seq,
        content: chunk.content,
        timestamp: chunk.timestamp,
      });
      inserted++;
    }

    // Update worker's updatedAt if any messages were inserted
    if (inserted > 0) {
      await ctx.db.patch(args.workerId, { updatedAt: Date.now() });
    }

    return { inserted, skipped };
  },
});
