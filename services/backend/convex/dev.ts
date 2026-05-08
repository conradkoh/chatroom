/**
 * Development-only internal mutations.
 *
 * These are NOT exposed to the web or daemon callers. They are invoked locally
 * via `convex run --internal dev:cleanup` to clean up state, seed data, or
 * migrate schemas during development.
 *
 * Usage:
 *   cd services/backend
 *   npx convex run --internal dev:cleanup
 *
 * Or from the repo root:
 *   pnpm dev:convex
 */

import { internalMutation } from './_generated/server.js';

// ─── cleanup ──────────────────────────────────────────────────────────────────

/**
 * Clean up internal state from deprecated implementations.
 *
 * Run this after schema migrations or when old data needs purging:
 *   cd services/backend && npx convex run dev:cleanup
 *
 * Step 6 (two-tier storage migration):
 *   - Purges ALL chatroom_harnessSessionMessages rows. The chunk table is
 *     ephemeral (1h TTL via purgeFinalizedChunks cron), but pre-migration data
 *     lacks turn rows to anchor it. Run this once after deploying the migration
 *     to clear legacy chunks, then never again unless the chunk table grows
 *     unexpectedly.
 *
 * lastProcessedSeq removal:
 *   - Clears the legacy `lastProcessedSeq` field from all chatroom_harnessSessions
 *     rows. The field has been removed from the schema; this patches existing rows
 *     so local dev data is consistent.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const cleanup: any = internalMutation({
  handler: async (ctx) => {
    // Purge ALL chunks (pre-migration data + any orphaned current chunks).
    // Safe because turn rows are now the source of truth for content.
    const allChunks = await ctx.db.query('chatroom_harnessSessionMessages').collect();
    for (const c of allChunks) {
      await ctx.db.delete(c._id);
    }
    if (allChunks.length > 0) {
      console.log(`[dev:cleanup] deleted ${allChunks.length} harness chunks`);
    }

    // Clear legacy lastProcessedSeq from all session rows.
    // The field is removed from schema; this unsets it on existing rows.
    const allSessions = await ctx.db.query('chatroom_harnessSessions').collect();
    let seqCleared = 0;
    for (const s of allSessions) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((s as any).lastProcessedSeq !== undefined) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await ctx.db.patch('chatroom_harnessSessions', s._id, {
          lastProcessedSeq: undefined,
        } as any);
        seqCleared++;
      }
    }
    if (seqCleared > 0) {
      console.log(`[dev:cleanup] cleared lastProcessedSeq from ${seqCleared} harness sessions`);
    }
  },
});
