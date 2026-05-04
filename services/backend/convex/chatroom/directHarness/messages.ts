/**
 * HarnessSession message mutations and queries for the direct-harness feature.
 *
 * All functions require:
 *  1. directHarnessWorkers feature flag enabled
 *  2. Valid SessionIdArg authentication
 *  3. Chatroom membership (resolved via workspace's chatroomId)
 */

import { v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { getSessionWithAccess, requireDirectHarnessWorkers } from './helpers.js';
import { mutation, query } from '../../_generated/server.js';

// ─── appendMessages ──────────────────────────────────────────────────────────

/**
 * Append output chunks from a harness session to its message stream.
 * Idempotent on (harnessSessionRowId, seq) — duplicate chunks are silently skipped.
 * Returns { inserted, skipped } counts.
 */
export const appendMessages = mutation({
  args: {
    ...SessionIdArg,
    harnessSessionRowId: v.id('chatroom_harnessSessions'),
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
    await getSessionWithAccess(ctx, args.sessionId, args.harnessSessionRowId);

    let inserted = 0;
    let skipped = 0;

    for (const chunk of args.chunks) {
      // Idempotency check: skip if (harnessSessionRowId, seq) already exists
      const existing = await ctx.db
        .query('chatroom_harnessSessionMessages')
        .withIndex('by_session_seq', (q) =>
          q.eq('harnessSessionRowId', args.harnessSessionRowId).eq('seq', chunk.seq)
        )
        .unique();

      if (existing) {
        skipped++;
        continue;
      }

      await ctx.db.insert('chatroom_harnessSessionMessages', {
        harnessSessionRowId: args.harnessSessionRowId,
        seq: chunk.seq,
        content: chunk.content,
        timestamp: chunk.timestamp,
      });
      inserted++;
    }

    // Update session's lastActiveAt if any messages were inserted
    if (inserted > 0) {
      await ctx.db.patch("chatroom_harnessSessions", args.harnessSessionRowId, { lastActiveAt: Date.now() });
    }

    return { inserted, skipped };
  },
});

// ─── streamSessionMessages ────────────────────────────────────────────────────

/**
 * Return messages for a harness session ordered by seq ascending.
 * When afterSeq is provided, only messages with seq > afterSeq are returned
 * (useful for cursor-based streaming without re-fetching already-seen chunks).
 */
export const streamSessionMessages = query({
  args: {
    ...SessionIdArg,
    harnessSessionRowId: v.id('chatroom_harnessSessions'),
    afterSeq: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    requireDirectHarnessWorkers();
    await getSessionWithAccess(ctx, args.sessionId, args.harnessSessionRowId);

    const messages = await ctx.db
      .query('chatroom_harnessSessionMessages')
      .withIndex('by_session_seq', (q) =>
        q.eq('harnessSessionRowId', args.harnessSessionRowId)
      )
      .order('asc')
      .collect();

    if (args.afterSeq !== undefined) {
      return messages.filter((m) => m.seq > args.afterSeq!);
    }

    return messages;
  },
});
