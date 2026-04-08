/**
 * Event Stream Cleanup
 *
 * Scheduled cleanup of old events from chatroom_eventStream.
 * Prevents unbounded growth of the event table.
 */

import { internal } from './_generated/api';
import { internalMutation } from './_generated/server';

/** Maximum age of events to keep (24 hours). */
const MAX_EVENT_AGE_MS = 24 * 60 * 60 * 1000;

/** Maximum events to delete per run (to stay within mutation limits). */
const BATCH_SIZE = 4000;

/**
 * Delete old events from chatroom_eventStream.
 * Runs as a scheduled cron job.
 */
export const cleanupOldEvents = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - MAX_EVENT_AGE_MS;

    // Query old events (by creation time, oldest first)
    const oldEvents = await ctx.db
      .query('chatroom_eventStream')
      .order('asc')
      .filter((q) => q.lt(q.field('_creationTime'), cutoff))
      .take(BATCH_SIZE);

    let deleted = 0;
    for (const event of oldEvents) {
      await ctx.db.delete(event._id);
      deleted++;
    }

    if (deleted > 0) {
      console.log(`[EventCleanup] Deleted ${deleted} old events (cutoff: ${new Date(cutoff).toISOString()})`);
    }

    // Self-reschedule if we hit the batch limit (more rows likely remain)
    if (deleted === BATCH_SIZE) {
      await ctx.scheduler.runAfter(0, internal.eventCleanup.cleanupOldEvents);
    }
  },
});
