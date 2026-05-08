/**
 * Web-facing harness session message endpoints.
 *
 * Called from the web UI to send user messages and subscribe to the message stream.
 */

import { ConvexError, v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { getNextMessageSeq, getSessionWithAccess, requireDirectHarnessWorkers } from '../../api/directHarnessHelpers.js';
import { mutation, query } from '../../_generated/server.js';

// ─── send ─────────────────────────────────────────────────────────────────────

export const send = mutation({
  args: {
    ...SessionIdArg,
    harnessSessionId: v.id('chatroom_harnessSessions'),
    text: v.string(),
  },
  handler: async (ctx, args) => {
    requireDirectHarnessWorkers();
    const { harnessSession } = await getSessionWithAccess(ctx, args.sessionId, args.harnessSessionId);

    if (harnessSession.status === 'closed' || harnessSession.status === 'failed') {
      throw new ConvexError({
        code: 'HARNESS_SESSION_CLOSED',
        message: `Session status is '${harnessSession.status}'`,
      });
    }
    if (!args.text.trim()) {
      throw new ConvexError({ code: 'HARNESS_SESSION_INVALID_PROMPT', message: 'Message text must not be empty' });
    }

    const now = Date.now();

    // ── Queue-routing decision ──────────────────────────────────────────────
    // Route to chatroom_harnessMessageQueue instead of the main message table
    // when any work is already in flight for this session. Three conditions
    // are checked so that every timing scenario is covered:
    //
    //  1. isGenerating  — agent is currently streaming; the daemon sets this
    //                     flag before calling session.prompt().
    //
    //  2. Unprocessed user messages  — messages already in the main table
    //     with seq > lastProcessedSeq that the daemon has not yet consumed.
    //     This closes the race window where two messages arrive before the
    //     daemon sets isGenerating: both land after the first user message
    //     which hasn't been processed yet, so the second must queue.
    //
    //  3. Existing queue items  — messages already waiting in the queue.
    //     Prevents a second message from bypassing a queued first message if
    //     isGenerating was cleared early and lastProcessedSeq has caught up.
    //
    const isGenerating = harnessSession.isGenerating ?? false;

    const unprocessedUserMsg = isGenerating
      ? null // skip extra query when already routing to queue
      : await ctx.db
          .query('chatroom_harnessSessionMessages')
          .withIndex('by_session_role_seq', (q) =>
            q
              .eq('harnessSessionId', args.harnessSessionId)
              .eq('role', 'user')
              .gt('seq', harnessSession.lastProcessedSeq)
          )
          .first();

    const hasQueuedItem =
      isGenerating || unprocessedUserMsg !== null
        ? null // skip extra query — already routing to queue
        : await ctx.db
            .query('chatroom_harnessMessageQueue')
            .withIndex('by_session_status', (q) =>
              q.eq('harnessSessionId', args.harnessSessionId).eq('status', 'queued')
            )
            .first();

    const shouldQueue =
      isGenerating || unprocessedUserMsg !== null || hasQueuedItem !== null;

    if (shouldQueue) {
      await ctx.db.insert('chatroom_harnessMessageQueue', {
        harnessSessionId: args.harnessSessionId,
        content: args.text.trim(),
        timestamp: now,
        status: 'queued',
      });
      await ctx.db.patch('chatroom_harnessSessions', args.harnessSessionId, { lastActiveAt: now });
      return { queued: true as const };
    }

    const seq = await getNextMessageSeq(ctx, args.harnessSessionId);
    await ctx.db.insert('chatroom_harnessSessionMessages', {
      harnessSessionId: args.harnessSessionId, seq, role: 'user', content: args.text.trim(), timestamp: now,
    });
    await ctx.db.patch('chatroom_harnessSessions', args.harnessSessionId, { lastActiveAt: now });
    return { seq };
  },
});

// ─── subscribe ────────────────────────────────────────────────────────────────
// Kept for backward-compat and tests. New code should use the split queries below.

export const subscribe = query({
  args: {
    ...SessionIdArg,
    harnessSessionId: v.id('chatroom_harnessSessions'),
    afterSeq: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    requireDirectHarnessWorkers();
    await getSessionWithAccess(ctx, args.sessionId, args.harnessSessionId);

    const messages = await ctx.db
      .query('chatroom_harnessSessionMessages')
      .withIndex('by_session_seq', (q) => q.eq('harnessSessionId', args.harnessSessionId))
      .order('asc')
      .collect();

    if (args.afterSeq !== undefined) {
      const after = args.afterSeq;
      return messages.filter((m) => m.seq > after);
    }
    return messages;
  },
});

// ─── getLatestMessages ────────────────────────────────────────────────────────

/**
 * One-shot initial load: returns the last `limit` messages for a session,
 * ordered oldest-to-newest, plus metadata for the tail cursor and pagination.
 *
 * Called imperatively (not via useQuery) so it never sets up a reactive
 * subscription — the tail subscription (getMessagesSince) handles live updates.
 */
export const getLatestMessages = query({
  args: {
    ...SessionIdArg,
    harnessSessionId: v.id('chatroom_harnessSessions'),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    requireDirectHarnessWorkers();
    await getSessionWithAccess(ctx, args.sessionId, args.harnessSessionId);

    const limit = args.limit ?? 50;

    // Fetch the last `limit` messages by descending seq, then reverse so the
    // result is oldest-to-newest for display.
    const rows = await ctx.db
      .query('chatroom_harnessSessionMessages')
      .withIndex('by_session_seq', (q) => q.eq('harnessSessionId', args.harnessSessionId))
      .order('desc')
      .take(limit + 1); // +1 to detect whether there are more older messages

    const hasMore = rows.length > limit;
    const messages = rows.slice(0, limit).reverse();
    const newestSeq = messages.length > 0 ? messages[messages.length - 1].seq : 0;

    return { messages, hasMore, newestSeq };
  },
});

// ─── getMessagesSince ─────────────────────────────────────────────────────────

/**
 * Reactive tail subscription: returns all messages with seq > afterSeq.
 *
 * `afterSeq` is pinned to the newest seq from the initial load and never
 * changes, so Convex only re-evaluates this query when new rows are inserted
 * rather than re-sending the full history on every insert.
 */
export const getMessagesSince = query({
  args: {
    ...SessionIdArg,
    harnessSessionId: v.id('chatroom_harnessSessions'),
    afterSeq: v.number(),
  },
  handler: async (ctx, args) => {
    requireDirectHarnessWorkers();
    await getSessionWithAccess(ctx, args.sessionId, args.harnessSessionId);

    return ctx.db
      .query('chatroom_harnessSessionMessages')
      .withIndex('by_session_seq', (q) =>
        q.eq('harnessSessionId', args.harnessSessionId).gt('seq', args.afterSeq)
      )
      .order('asc')
      .collect();
  },
});

// ─── getOlderMessages ─────────────────────────────────────────────────────────

/**
 * On-demand pagination: returns the `limit` messages immediately before
 * `beforeSeq`, oldest-to-newest, for "load more history" scroll-up UX.
 */
export const getOlderMessages = query({
  args: {
    ...SessionIdArg,
    harnessSessionId: v.id('chatroom_harnessSessions'),
    beforeSeq: v.number(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    requireDirectHarnessWorkers();
    await getSessionWithAccess(ctx, args.sessionId, args.harnessSessionId);

    const limit = args.limit ?? 50;

    const rows = await ctx.db
      .query('chatroom_harnessSessionMessages')
      .withIndex('by_session_seq', (q) =>
        q.eq('harnessSessionId', args.harnessSessionId).lt('seq', args.beforeSeq)
      )
      .order('desc')
      .take(limit + 1);

    const hasMore = rows.length > limit;
    const messages = rows.slice(0, limit).reverse();

    return { messages, hasMore };
  },
});
