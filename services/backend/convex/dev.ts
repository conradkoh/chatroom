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
 *   - The legacy `lastProcessedSeq` field on chatroom_harnessSessions remains
 *     in the schema for a future cleanup PR (it coexists safely with the new
 *     lastProcessedTurnSeq field).
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

    // Note: The legacy `lastProcessedSeq` field can also be cleared here if
    // desired, but it is still safely coexisting with lastProcessedTurnSeq
    // and will be removed in a future schema cleanup PR.
  },
});
