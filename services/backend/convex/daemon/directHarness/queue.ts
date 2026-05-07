/**
 * Daemon-only mutations for the message queue.
 *
 * setGenerating  — flips the isGenerating flag on a session row.
 * dequeueNext    — atomically promotes the oldest queued message into the main
 *                  message stream and returns it so the daemon can prompt it.
 *                  Sets isGenerating=false and returns null when the queue is empty.
 */

import { v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { getAuthenticatedUser } from '../../auth/authenticatedUser.js';
import { getNextMessageSeq, requireDirectHarnessWorkers } from '../../api/directHarnessHelpers.js';
import { mutation } from '../../_generated/server.js';

// ─── setGenerating ────────────────────────────────────────────────────────────

export const setGenerating = mutation({
  args: {
    ...SessionIdArg,
    harnessSessionId: v.id('chatroom_harnessSessions'),
    isGenerating: v.boolean(),
  },
  handler: async (ctx, args) => {
    requireDirectHarnessWorkers();
    const auth = await getAuthenticatedUser(ctx, args.sessionId);
    if (!auth.ok) throw new Error('Authentication required');
    const session = await ctx.db.get('chatroom_harnessSessions', args.harnessSessionId);
    if (!session) return;
    await ctx.db.patch('chatroom_harnessSessions', args.harnessSessionId, {
      isGenerating: args.isGenerating,
    });
  },
});

// ─── dequeueNext ─────────────────────────────────────────────────────────────

/**
 * Atomically:
 *   1. Gets the oldest queued item for the session (FIFO by _creationTime).
 *   2. If none:  sets isGenerating=false and returns null.
 *   3. If found: marks it delivered, inserts it into chatroom_harnessSessionMessages
 *      (role=user), and returns { content, seq }.
 *      isGenerating remains true — the daemon is about to send another prompt.
 */
export const dequeueNext = mutation({
  args: {
    ...SessionIdArg,
    harnessSessionId: v.id('chatroom_harnessSessions'),
  },
  handler: async (ctx, args) => {
    requireDirectHarnessWorkers();
    const auth = await getAuthenticatedUser(ctx, args.sessionId);
    if (!auth.ok) throw new Error('Authentication required');

    const item = await ctx.db
      .query('chatroom_harnessMessageQueue')
      .withIndex('by_session_status', (q) =>
        q.eq('harnessSessionId', args.harnessSessionId).eq('status', 'queued')
      )
      .order('asc') // oldest first — _creationTime ascending
      .first();

    if (!item) {
      await ctx.db.patch('chatroom_harnessSessions', args.harnessSessionId, {
        isGenerating: false,
      });
      return null;
    }

    // Promote to the main message table.
    await ctx.db.patch('chatroom_harnessMessageQueue', item._id, { status: 'delivered' });

    const seq = await getNextMessageSeq(ctx, args.harnessSessionId);
    await ctx.db.insert('chatroom_harnessSessionMessages', {
      harnessSessionId: args.harnessSessionId,
      seq,
      role: 'user',
      content: item.content,
      timestamp: item.timestamp,
    });

    await ctx.db.patch('chatroom_harnessSessions', args.harnessSessionId, {
      lastActiveAt: Date.now(),
    });

    return { content: item.content, seq };
  },
});
