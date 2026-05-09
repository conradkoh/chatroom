/**
 * Direct Harness Cleanup — TTL-based cleanup for ephemeral chunk data.
 *
 * The chunk table (chatroom_harnessSessionMessages) is ephemeral: once a turn
 * is finalized (status='complete' or 'failed'), its chunks are dead weight.
 * An hourly cron purges chunks belonging to turns finalized more than 1 hour ago.
 *
 * Design notes:
 * - Bounded: processes at most BATCH_SIZE turns per tick to stay within mutation limits.
 * - Self-resuming: once chunks are deleted they won't re-match; next tick picks up remaining.
 * - Safe: streaming/pending turns have undefined completedAt so they never match.
 * - Race-free: finalizeAssistantTurn aggregates chunks and sets status='complete' in
 *   the same mutation, so no further chunks for that messageId can arrive after finalization.
 */

import { internalMutation } from './_generated/server.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const BATCH_SIZE = 500;
const ONE_HOUR_MS = 60 * 60 * 1000;

// ─── purgeFinalizedChunks ─────────────────────────────────────────────────────

/**
 * Deletes chunks (chatroom_harnessSessionMessages) for turns that have been
 * finalized (status='complete' or 'failed') more than 1 hour ago.
 *
 * Bounded at BATCH_SIZE=500 turns per tick. The cron is self-resuming:
 * chunks deleted in one tick won't re-match, so subsequent ticks make progress.
 *
 * Returns counts for observability.
 */
export const purgeFinalizedChunks = internalMutation({
  args: {},
  handler: async (ctx) => {
    const threshold = Date.now() - ONE_HOUR_MS;
    let turnsScanned = 0;
    let chunksDeleted = 0;
    let remaining = BATCH_SIZE;

    for (const status of ['complete', 'failed'] as const) {
      if (remaining <= 0) break;

      const batch = await ctx.db
        .query('chatroom_harnessSessionTurns')
        .withIndex('by_status_completedAt', (q) =>
          q.eq('status', status).lt('completedAt', threshold)
        )
        .take(remaining);

      for (const turn of batch) {
        turnsScanned++;
        remaining--;

        if (!turn.messageId) continue; // no chunks to delete (e.g. pending orphan)

        const chunks = await ctx.db
          .query('chatroom_harnessSessionMessages')
          .withIndex('by_messageId', (q) => q.eq('messageId', turn.messageId))
          .collect();

        for (const chunk of chunks) {
          await ctx.db.delete(chunk._id);
          chunksDeleted++;
        }
      }
    }

    if (chunksDeleted > 0) {
      console.log(`[harness-cleanup] purged ${chunksDeleted} chunks across ${turnsScanned} turns`);
    }

    return { turnsScanned, chunksDeleted };
  },
});
