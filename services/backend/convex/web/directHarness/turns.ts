/**
 * Web-facing harness session turn endpoints.
 *
 * These replace the chunk-table reading endpoints (getLatestMessages,
 * getMessagesSince, getOlderMessages, subscribe). The frontend now reads
 * pre-grouped turns from chatroom_harnessSessionTurns directly.
 *
 * For the single in-flight streaming turn, the frontend additionally
 * subscribes to getStreamingTurnChunks which returns the raw chunk rows
 * ordered by seq — enabling token-by-token incremental display.
 */

import { v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import {
  getSessionWithAccess,
  requireDirectHarnessWorkers,
} from '../../api/directHarnessHelpers.js';
import { query } from '../../_generated/server.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Strip harnessSessionId from a turn row for the wire shape. */
function toView(row: {
  _id: string;
  turnSeq: number;
  role: 'user' | 'assistant';
  status: 'pending' | 'streaming' | 'complete' | 'failed';
  messageId?: string;
  textContent: string;
  reasoningContent: string;
  startedAt: number;
  completedAt?: number;
  [key: string]: unknown;
}) {
  return {
    _id: row._id,
    turnSeq: row.turnSeq,
    role: row.role,
    status: row.status,
    messageId: row.messageId,
    textContent: row.textContent,
    reasoningContent: row.reasoningContent,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
  };
}

// ─── getLatestTurns ────────────────────────────────────────────────────────────

/**
 * One-shot initial load: returns the last `limit` turns for a session,
 * ordered oldest-to-newest, plus metadata for pagination.
 *
 * Called imperatively (not via useQuery) so no reactive subscription is set up.
 * The tail subscription (getTurnsSince) handles live updates.
 */
export const getLatestTurns = query({
  args: {
    ...SessionIdArg,
    harnessSessionId: v.id('chatroom_harnessSessions'),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    requireDirectHarnessWorkers();
    await getSessionWithAccess(ctx, args.sessionId, args.harnessSessionId);

    const limit = args.limit ?? 50;

    const rows = await ctx.db
      .query('chatroom_harnessSessionTurns')
      .withIndex('by_session_turnSeq', (q) => q.eq('harnessSessionId', args.harnessSessionId))
      .order('desc')
      .take(limit + 1);

    const hasMore = rows.length > limit;
    const turns = rows.slice(0, limit).reverse().map(toView);
    const newestTurnSeq = turns.length > 0 ? turns[turns.length - 1]!.turnSeq : null;

    return { turns, hasMore, newestTurnSeq };
  },
});

// ─── getTurnsSince ─────────────────────────────────────────────────────────────

/**
 * Reactive tail subscription: returns all turns with turnSeq > afterTurnSeq.
 *
 * Also fires when existing turns are updated (e.g., status pending→streaming→complete),
 * since Convex re-evaluates the whole query when any row in the matching index
 * range changes.
 *
 * afterTurnSeq should be set to `oldestTurnSeq - 1` after initial load so that
 * both new turns AND status changes on already-visible turns are delivered.
 */
export const getTurnsSince = query({
  args: {
    ...SessionIdArg,
    harnessSessionId: v.id('chatroom_harnessSessions'),
    afterTurnSeq: v.number(),
  },
  handler: async (ctx, args) => {
    requireDirectHarnessWorkers();
    await getSessionWithAccess(ctx, args.sessionId, args.harnessSessionId);

    const rows = await ctx.db
      .query('chatroom_harnessSessionTurns')
      .withIndex('by_session_turnSeq', (q) =>
        q.eq('harnessSessionId', args.harnessSessionId).gt('turnSeq', args.afterTurnSeq)
      )
      .order('asc')
      .collect();

    return rows.map(toView);
  },
});

// ─── getOlderTurns ─────────────────────────────────────────────────────────────

/**
 * On-demand pagination: returns the `limit` turns immediately before
 * `beforeTurnSeq`, oldest-to-newest, for "load more history" scroll-up UX.
 */
export const getOlderTurns = query({
  args: {
    ...SessionIdArg,
    harnessSessionId: v.id('chatroom_harnessSessions'),
    beforeTurnSeq: v.number(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    requireDirectHarnessWorkers();
    await getSessionWithAccess(ctx, args.sessionId, args.harnessSessionId);

    const limit = args.limit ?? 50;

    const rows = await ctx.db
      .query('chatroom_harnessSessionTurns')
      .withIndex('by_session_turnSeq', (q) =>
        q.eq('harnessSessionId', args.harnessSessionId).lt('turnSeq', args.beforeTurnSeq)
      )
      .order('desc')
      .take(limit + 1);

    const hasMore = rows.length > limit;
    const turns = rows.slice(0, limit).reverse().map(toView);

    return { turns, hasMore };
  },
});

// ─── getStreamingTurnChunks ────────────────────────────────────────────────────

/**
 * Reactive subscription for the in-flight streaming turn's raw chunks.
 *
 * The frontend subscribes to this while there is a turn with status='streaming'
 * and a bound messageId. Returns the most recent `limit` (default 200) chunk
 * rows ordered by seq ascending so the client can append new tokens
 * incrementally.
 *
 * By returning only the tail of the chunk stream, Convex only re-evaluates
 * this query when new chunks arrive — and returns at most O(limit) rows
 * regardless of how long the generation has been running.
 *
 * When the streaming turn finalizes (status flips to 'complete'), the frontend
 * drops this subscription (passes 'skip') and uses the canonical textContent /
 * reasoningContent from the turn row instead.
 */
export const getStreamingTurnChunks = query({
  args: {
    ...SessionIdArg,
    harnessSessionId: v.id('chatroom_harnessSessions'),
    messageId: v.string(),
    /** Maximum number of chunks to return. Defaults to 200. */
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    requireDirectHarnessWorkers();
    await getSessionWithAccess(ctx, args.sessionId, args.harnessSessionId);

    const limit = args.limit ?? 200;

    // Fetch newest `limit` chunks (desc), then sort asc so the client can
    // concatenate in order. This bounds the query to O(limit) rows regardless
    // of how many chunks have accumulated.
    const rows = await ctx.db
      .query('chatroom_harnessSessionMessages')
      .withIndex('by_messageId', (q) => q.eq('messageId', args.messageId))
      .order('desc')
      .take(limit);

    // Restore ascending order for the client
    rows.sort((a, b) => a.seq - b.seq);
    return rows;
  },
});
