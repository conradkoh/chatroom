/**
 * Event Stream Cleanup
 *
 * Scheduled cleanup of old events from chatroom_eventStream.
 * Prevents unbounded growth of the event table.
 *
 * Uses the `by_timestamp` index so each batch is range-bounded rather than
 * scanning the full table. All event variants carry `timestamp`.
 */

import { internal } from './_generated/api';
import { internalMutation } from './_generated/server';

/** Maximum age of events to keep (24 hours). */
const MAX_EVENT_AGE_MS = 24 * 60 * 60 * 1000;

/** Maximum events to delete per run (to stay within mutation limits). */
const BATCH_SIZE = 2000;

/**
 * Delete old events from chatroom_eventStream.
 * Runs as a scheduled cron job every 15 minutes.
 */
export const cleanupOldEvents = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - MAX_EVENT_AGE_MS;

    const oldEvents = await ctx.db
      .query('chatroom_eventStream')
      .withIndex('by_timestamp', (q) => q.lt('timestamp', cutoff))
      .order('asc')
      .take(BATCH_SIZE);

    let deleted = 0;
    for (const event of oldEvents) {
      await ctx.db.delete('chatroom_eventStream', event._id);
      deleted++;
    }

    if (deleted > 0) {
      console.log(
        `[EventCleanup] Deleted ${deleted} old events (cutoff: ${new Date(cutoff).toISOString()})`
      );
    }

    // Self-reschedule if we hit the batch limit (more rows likely remain)
    if (deleted === BATCH_SIZE) {
      await ctx.scheduler.runAfter(0, internal.eventCleanup.cleanupOldEvents);
    }
  },
});
