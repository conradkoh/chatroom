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
