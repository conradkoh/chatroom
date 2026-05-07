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
