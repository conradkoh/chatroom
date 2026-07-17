/**
 * Web-facing harness session turn endpoints.
 *
 * These replace the chunk-table reading endpoints (getLatestMessages,
 * getMessagesSince, getOlderMessages, subscribe). The frontend now reads
 * pre-grouped turns from chatroom_harnessSessionTurns directly.
 *
 * For the single in-flight streaming turn, the frontend additionally
 * subscribes to getStreamingTurnChunks which returns the raw chunk rows
 * ordered by _creationTime ascending — enabling token-by-token incremental display.
 */

import { v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { getSessionWithAccess, requireDirectHarnessWorkers } from '../../api/directHarnessHelpers';
import { query } from '../../_generated/server';
import {
  buildLatestTurnsPage,
  buildOlderTurnsPage,
  fetchStreamingTurnChunks,
  toHarnessTurnView,
} from '../../api/harnessTurnViewHelpers';

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

    return buildLatestTurnsPage(rows, limit);
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

    return rows.map(toHarnessTurnView);
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

    return buildOlderTurnsPage(rows, limit);
  },
});

// ─── getStreamingTurnChunks ────────────────────────────────────────────────────

/**
 * Reactive subscription for the in-flight streaming turn's raw chunks.
 *
 * The frontend subscribes to this while there is a turn with status='streaming'
 * and a bound messageId. Returns the most recent `limit` (default 200) chunk
 * rows ordered by _creationTime ascending so the client can append new tokens
 * incrementally.
 *
 * ## Cursor-based incremental fetching (afterCreationTime)
 *
 * When `afterCreationTime` is supplied the query returns only chunks with
 * `_creationTime >= afterCreationTime` in ascending order — eliminating the
 * O(N) wire payload that grows with every new chunk when no cursor is used.
 * The client's Set-based dedup handles the gte boundary so no chunk is lost.
 *
 * Without a cursor the legacy behaviour is preserved: fetch the newest `limit`
 * chunks descending and resort ascending (initial load path).
 *
 * The `by_messageId` index implicitly includes `_creationTime` as a trailing
 * sort field (Convex appends it to every index), so no schema change is needed.
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
    /**
     * Cursor: only return chunks with _creationTime >= this value.
     * Use gte (not gt) so chunks sharing the same _creationTime as the last
     * seen are still included — the client deduplicates via a Set of _ids.
     * When absent the query falls back to the initial-load "newest N desc →
     * resort asc" behaviour.
     */
    afterCreationTime: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    requireDirectHarnessWorkers();
    await getSessionWithAccess(ctx, args.sessionId, args.harnessSessionId);

    return fetchStreamingTurnChunks(ctx, 'chatroom_harnessSessionMessages', {
      messageId: args.messageId,
      limit: args.limit ?? 200,
      afterCreationTime: args.afterCreationTime,
    });
  },
});
