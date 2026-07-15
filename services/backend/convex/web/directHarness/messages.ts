/**
 * Web-facing harness session message endpoints.
 *
 * Called from the web UI to send user messages.
 *
 * NOTE: The chunk-table reading endpoints (subscribe, getLatestMessages,
 * getMessagesSince, getOlderMessages) have been removed in favour of the
 * turn-based endpoints in web/directHarness/turns.ts. Chunk rows are now
 * only read by (a) the daemon's finalizeAssistantTurn aggregation and
 * (b) the frontend's getStreamingTurnChunks for the in-flight streaming turn.
 */

import { ConvexError, v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { mutation } from '../../_generated/server';
import { getSessionWithAccess, requireDirectHarnessWorkers } from '../../api/directHarnessHelpers';
import { insertUserTurn } from '../../daemon/directHarness/insert-user-turn';

// ─── send ─────────────────────────────────────────────────────────────────────

export const send = mutation({
  args: {
    ...SessionIdArg,
    harnessSessionId: v.id('chatroom_harnessSessions'),
    text: v.string(),
  },
  handler: async (ctx, args) => {
    requireDirectHarnessWorkers();
    const { harnessSession } = await getSessionWithAccess(
      ctx,
      args.sessionId,
      args.harnessSessionId
    );

    if (harnessSession.status === 'closed' || harnessSession.status === 'failed') {
      throw new ConvexError({
        code: 'HARNESS_SESSION_CLOSED',
        message: `Session status is '${harnessSession.status}'`,
      });
    }
    if (!args.text.trim()) {
      throw new ConvexError({
        code: 'HARNESS_SESSION_INVALID_PROMPT',
        message: 'Message text must not be empty',
      });
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
    //  2. Unprocessed user turns  — turns already in the turn table with
    //     turnSeq > lastProcessedTurnSeq that the daemon has not yet consumed.
    //     This closes the race window where two messages arrive before the
    //     daemon sets isGenerating: both land after the first user turn
    //     which hasn't been processed yet, so the second must queue.
    //
    //  3. Existing queue items  — messages already waiting in the queue.
    //     Prevents a second message from bypassing a queued first message if
    //     isGenerating was cleared early and the turn cursor has caught up.
    //
    const isGenerating = harnessSession.isGenerating ?? false;

    const unprocessedUserMsg = isGenerating
      ? null // skip extra query when already routing to queue
      : await ctx.db
          .query('chatroom_harnessSessionTurns')
          .withIndex('by_session_turnSeq', (q) =>
            q
              .eq('harnessSessionId', args.harnessSessionId)
              .gt('turnSeq', harnessSession.lastProcessedTurnSeq ?? 0)
          )
          .filter((q) => q.eq(q.field('role'), 'user'))
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

    const shouldQueue = isGenerating || unprocessedUserMsg !== null || hasQueuedItem !== null;

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

    const { turnSeq } = await insertUserTurn(ctx, args.harnessSessionId, args.text, now);
    return { turnSeq };
  },
});
