/**
 * Development-only internal mutations.
 *
 * These are NOT exposed to the web or daemon callers. They are invoked locally
 * via `npx convex run --internal dev:cleanup` to clean up state, seed data, or
 * migrate schemas during development.
 *
 * ─── Quick usage ──────────────────────────────────────────────────────────────
 *
 *   cd services/backend && npx convex run dev:cleanup --push
 *
 * Or from the repo root:
 *
 *   pnpm dev:convex
 *
 * ─── Step-by-step workflow for schema-migration cleanups ──────────────────────
 *
 * Use this when Convex refuses to push because existing documents contain fields
 * that have been removed or renamed in the schema (schema validation failure).
 *
 * STEP 1 — Identify the offending field and table from the error message, e.g.:
 *
 *   ✖ Schema validation failed.
 *   Document … in table "chatroom_harnessSessions" does not match the schema:
 *   Object contains extra field `lastProcessedSeq` that is not in the validator.
 *
 * STEP 2 — Temporarily re-add the old field to the schema as optional so that
 *   Convex will accept a push while the stale documents still exist.
 *
 *   In convex/schema.ts, find the relevant table definition and add:
 *
 *     /** @deprecated — kept temporarily for migration cleanup *\/
 *     oldFieldName: v.optional(v.number()),   // use the correct type
 *
 * STEP 3 — Write the cleanup handler below to delete (or patch) the affected
 *   documents. Example — delete all sessions that still carry the old field:
 *
 *     const all = await ctx.db.query('chatroom_harnessSessions').collect();
 *     for (const doc of all) {
 *       if ('oldFieldName' in (doc as any)) {
 *         await ctx.db.delete(doc._id);
 *       }
 *     }
 *
 *   If you need to migrate rather than delete, use ctx.db.patch() instead:
 *
 *     await ctx.db.patch(doc._id, {
 *       newFieldName: (doc as any).oldFieldName,
 *       oldFieldName: undefined,   // removes the field
 *     });
 *
 * STEP 4 — Push and run the mutation:
 *
 *   cd services/backend && npx convex run dev:cleanup --push
 *
 *   Confirm the log line shows the expected number of affected documents.
 *
 * STEP 5 — Revert both changes:
 *   a. Remove the temporary field from convex/schema.ts.
 *   b. Reset the handler below back to a no-op (keep this comment block intact).
 *
 * STEP 6 — Push the clean schema to confirm no further validation errors:
 *
 *   cd services/backend && npx convex dev --once
 *
 * ─── Mutation history ─────────────────────────────────────────────────────────
 *
 * Step 6 — two-tier storage migration
 *   Purged ALL chatroom_harnessSessionMessages rows. The chunk table is
 *   ephemeral (1h TTL via purgeFinalizedChunks cron), but pre-migration data
 *   lacked turn rows to anchor it.
 *
 * Step 7 — lastProcessedSeq → lastProcessedTurnSeq rename
 *   Deleted 9 legacy chatroom_harnessSessions documents that still carried
 *   the old `lastProcessedSeq` field after it was renamed to
 *   `lastProcessedTurnSeq`.
 */

import { internalMutation } from './_generated/server.js';

// ─── cleanup ──────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const cleanup: any = internalMutation({
  handler: async (_ctx) => {
    // no-op — see step-by-step workflow above when you need to run a migration.
  },
});
