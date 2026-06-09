/**
 * Connection Close Request Cleanup
 *
 * Scheduled removal of expired rows from chatroom_connectionCloseRequests.
 * Keeps the append-only close-request list bounded.
 */

import { internal } from './_generated/api';
import { internalMutation } from './_generated/server';

/** Maximum rows to delete per run (stay within mutation limits). */
const BATCH_SIZE = 2000;

export const cleanupExpiredConnectionCloseRequests = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();

    const expired = await ctx.db
      .query('chatroom_connectionCloseRequests')
      .withIndex('by_expiresAt', (q) => q.lt('expiresAt', now))
      .take(BATCH_SIZE);

    let deleted = 0;
    for (const row of expired) {
      await ctx.db.delete('chatroom_connectionCloseRequests', row._id);
      deleted++;
    }

    if (deleted > 0) {
      console.log(`[ConnectionCleanup] Deleted ${deleted} expired connection close requests`);
    }

    // Self-reschedule if we hit the batch limit (more rows likely remain).
    if (deleted === BATCH_SIZE) {
      await ctx.scheduler.runAfter(
        0,
        internal.connectionCleanup.cleanupExpiredConnectionCloseRequests
      );
    }
  },
});
