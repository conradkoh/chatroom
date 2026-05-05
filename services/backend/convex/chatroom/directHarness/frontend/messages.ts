/**
 * Frontend-facing harness session message endpoints.
 *
 * Called from the web UI to send user messages and subscribe to the message
 * stream. Uses cursor-based pagination (afterSeq) for efficient delta updates.
 */

import { ConvexError, v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { getNextMessageSeq, getSessionWithAccess, requireDirectHarnessWorkers } from '../helpers.js';
import { mutation, query } from '../../../_generated/server.js';

// ─── send ─────────────────────────────────────────────────────────────────────

/**
 * Send a user message to an existing session.
 *
 * Appends the message to the message stream with role='user'. The daemon
 * picks up pending messages via pendingForMachine query and processes them.
 *
 * Returns the message's seq number so the frontend can track it.
 */
export const send = mutation({
  args: {
    ...SessionIdArg,
    harnessSessionRowId: v.id('chatroom_harnessSessions'),
    text: v.string(),
  },
  handler: async (ctx, args) => {
    requireDirectHarnessWorkers();

    const { harnessSession } = await getSessionWithAccess(
      ctx,
      args.sessionId,
      args.harnessSessionRowId
    );

    if (harnessSession.status === 'closed' || harnessSession.status === 'failed') {
      throw new ConvexError({
        code: 'HARNESS_SESSION_CLOSED',
        message: `Cannot send message — session ${args.harnessSessionRowId} status is '${harnessSession.status}'`,
      });
    }

    if (!args.text.trim()) {
      throw new ConvexError({
        code: 'HARNESS_SESSION_INVALID_PROMPT',
        message: 'Message text must not be empty',
      });
    }

    const now = Date.now();
    const seq = await getNextMessageSeq(ctx, args.harnessSessionRowId);

    await ctx.db.insert('chatroom_harnessSessionMessages', {
      harnessSessionRowId: args.harnessSessionRowId,
      seq,
      role: 'user',
      content: args.text.trim(),
      timestamp: now,
    });

    // Touch lastActiveAt so the session appears recent
    await ctx.db.patch('chatroom_harnessSessions', args.harnessSessionRowId, {
      lastActiveAt: now,
    });

    return { seq };
  },
});

// ─── subscribe ────────────────────────────────────────────────────────────────

/**
 * Subscribe to messages for a session, optionally starting after a known seq.
 *
 * When afterSeq is provided, only messages with seq > afterSeq are returned
 * (deltas only). Omit afterSeq for the initial fetch (returns all messages).
 *
 * Messages are ordered by seq ascending.
 */
export const subscribe = query({
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
