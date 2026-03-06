/**
 * Database Migrations
 *
 * Internal mutations and actions for one-off data migrations.
 * Run from the Convex dashboard as internal functions.
 *
 * Migrations are NOT run automatically by CI — they must be triggered manually
 * from the Convex dashboard after deploying. All migrations are idempotent and
 * safe to re-run.
 *
 * Previously executed migrations (removed after completion):
 * - Session expiration field removal (deprecated expiresAt/expiresAtLabel)
 * - User access level defaults (set undefined → 'user')
 * - Task origin normalization (set undefined → 'chat'/'backlog')
 * - Tool → Harness field rename (availableTools → availableHarnesses, etc.)
 */

import { internalMutation } from './_generated/server';

// ============================================================================
// PENDING MIGRATIONS — Run these after deploying to production
// ============================================================================

/**
 * Migration: Convert availableModels from string[] to Record<string, string[]>.
 *
 * The schema changed availableModels from a flat `string[]` to a per-harness
 * record `{ opencode: [...], pi: [...] }`. Existing machine documents written
 * by the old CLI still store a plain array, causing schema validation errors.
 *
 * The schema temporarily accepts both shapes via v.union(...) to allow this
 * migration to run without rejecting old documents. Once this migration has
 * been successfully run in production, do the following cleanup:
 *
 *   1. In schema.ts — revert availableModels back to:
 *        availableModels: v.optional(v.record(v.string(), v.array(v.string())))
 *      (remove the v.union wrapper and the DEPRECATED SHAPE comment)
 *
 *   2. Remove this migration (move description to the "Previously executed" list above).
 *
 * Idempotent: documents already in the record shape are skipped.
 *
 * Run from the Convex dashboard:
 *   internal.migration.migrateAvailableModelsToPerHarness
 */
export const migrateAvailableModelsToPerHarness = internalMutation({
  args: {},
  handler: async (ctx) => {
    const allMachines = await ctx.db.query('chatroom_machines').collect();

    let patched = 0;
    let skipped = 0;

    for (const machine of allMachines) {
      const raw = (machine as Record<string, unknown>).availableModels;

      // Skip if not set
      if (raw === undefined || raw === null) {
        skipped++;
        continue;
      }

      // Skip if already a record (not an array) — idempotent re-run guard
      if (!Array.isArray(raw)) {
        skipped++;
        continue;
      }

      // Convert flat string[] → { opencode: string[] }
      await ctx.db.patch(machine._id, {
        availableModels: { opencode: raw as string[] },
      });
      patched++;
    }

    return {
      total: allMachines.length,
      patched,
      skipped,
    };
  },
});

/**
 * Migration: Strip stale FSM fields from chatroom_participants.
 *
 * Phase 4 removed `status`, `readyUntil`, `activeUntil`, `cleanupDeadline`,
 * and `statusReason` from the schema. Existing documents written by the old
 * CLI still carry these fields, causing Convex schema validation errors.
 *
 * This migration patches each participant document by unsetting the stale
 * fields. Documents without any stale fields are skipped.
 *
 * Idempotent: documents with no stale fields are skipped on re-run.
 *
 * Run from the Convex dashboard:
 *   internal.migration.stripParticipantStaleFields
 */
export const stripParticipantStaleFields = internalMutation({
  args: {},
  handler: async (ctx) => {
    const allParticipants = await ctx.db.query('chatroom_participants').collect();

    const STALE_FIELDS = [
      'status',
      'readyUntil',
      'activeUntil',
      'cleanupDeadline',
      'statusReason',
      'desiredStatus',
      'pendingCommand',
    ] as const;

    let patched = 0;
    let skipped = 0;

    for (const participant of allParticipants) {
      const doc = participant as Record<string, unknown>;
      const staleFieldsPresent = STALE_FIELDS.filter((f) => f in doc);

      if (staleFieldsPresent.length === 0) {
        skipped++;
        continue;
      }

      // Unset only the stale fields — preserves all valid fields including
      // optional ones (connectionId, agentType, lastSeenAt, lastSeenAction,
      // lastSeenTokenAt) without needing to enumerate them explicitly.
      const unsetPatch = Object.fromEntries(
        staleFieldsPresent.map((f) => [f, undefined])
      );
      await ctx.db.patch(participant._id, unsetPatch);
      patched++;
    }

    return {
      total: allParticipants.length,
      patched,
      skipped,
    };
  },
});

/**
 * Migration: Remove idle participants (no-op — status field removed).
 *
 * The `status` field and 'idle' state were removed as part of the
 * lastSeenAt-based lifecycle refactor. This migration is now a no-op.
 * Kept for historical reference; safe to remove.
 *
 * Idempotent: always a no-op.
 */
export const removeIdleParticipants = internalMutation({
  args: {},
  handler: async (ctx) => {
    const allParticipants = await ctx.db.query('chatroom_participants').collect();

    return {
      total: allParticipants.length,
      deletedIdle: 0,
    };
  },
});

/**
 * Migration: Delete old-format chatroom_agentPreferences documents.
 *
 * The chatroom_agentPreferences table was redesigned from a per-chatroom format
 * (with harnessByRole/modelByRole maps) to a per-role format (with agentHarness,
 * role, model as scalar fields). Old documents in production still use the old
 * shape and fail schema validation on deployment.
 *
 * Since agentPreferences are purely UI hints and have no behavioral impact,
 * the safest migration is to delete old-format documents. Users will need to
 * re-save their preferences after the migration (by clicking "Start Agent" again).
 *
 * After this migration has run successfully in production:
 *   1. In schema.ts — restore agentHarness, role, and createdAt to required fields:
 *        role: v.string(),
 *        agentHarness: v.union(v.literal('opencode'), v.literal('pi')),
 *        createdAt: v.number(),
 *      (remove the DEPRECATED SHAPE comments and v.optional wrappers)
 *   2. Remove this migration (move description to "Previously executed" list above).
 *
 * Idempotent: documents already in the new format (with agentHarness) are skipped.
 *
 * Run from the Convex dashboard:
 *   internal.migration.deleteOldFormatAgentPreferences
 */
export const deleteOldFormatAgentPreferences = internalMutation({
  args: {},
  handler: async (ctx) => {
    const allPrefs = await ctx.db.query('chatroom_agentPreferences').collect();

    let deleted = 0;
    let skipped = 0;

    for (const pref of allPrefs) {
      // Old format: missing agentHarness (has harnessByRole map instead)
      const raw = pref as Record<string, unknown>;
      if (raw.agentHarness === undefined) {
        await ctx.db.delete('chatroom_agentPreferences', pref._id);
        deleted++;
      } else {
        skipped++;
      }
    }

    return { deleted, skipped, total: allPrefs.length };
  },
});

/**
 * Migration: Delete pre-refactor chatroom_messageQueue documents with legacy `taskId` field.
 *
 * The chatroom_messageQueue schema was refactored to remove the `taskId` back-reference
 * and replace it with `queuePosition` for ordering. Old documents from before the refactor
 * still have `taskId` but lack `queuePosition`, making them impossible to promote properly.
 *
 * Since these documents cannot be properly promoted, the safest migration is to delete them.
 * The user can re-send any messages that were in the queue.
 *
 * Schema cleanup already applied:
 *   - taskId field has been removed from chatroom_messageQueue schema
 *   - queuePosition is now required (v.number(), not optional)
 *
 * After running this migration in production, move its description to
 * the "Previously executed migrations" list and delete the function.
 *
 * Idempotent: documents without `taskId` are skipped.
 *
 * Run from the Convex dashboard:
 *   internal.migration.deleteLegacyMessageQueueDocuments
 */
export const deleteLegacyMessageQueueDocuments = internalMutation({
  args: {},
  handler: async (ctx) => {
    const allQueuedMessages = await ctx.db.query('chatroom_messageQueue').collect();

    let deleted = 0;
    let skipped = 0;

    for (const msg of allQueuedMessages) {
      const raw = msg as Record<string, unknown>;
      // Old format: has taskId (pre-refactor back-reference to chatroom_tasks)
      if (raw.taskId !== undefined) {
        await ctx.db.delete(msg._id);
        deleted++;
      } else {
        skipped++;
      }
    }

    return { deleted, skipped, total: allQueuedMessages.length };
  },
});

/**
 * Migration: Update chatroom_tasks with legacy "queued" status to "pending".
 *
 * The "queued" status was removed from chatroom_tasks in PR #23 (message queue
 * staging table refactor). Existing documents that still have status="queued"
 * cause Convex schema validation to fail at deploy time.
 *
 * After running this migration in production, remove v.literal('queued') from
 * chatroom_tasks.status in schema.ts and deploy again.
 *
 * Idempotent: safe to re-run (only patches documents with status="queued").
 *
 * Run from the Convex dashboard:
 *   internal.migration.migrateQueuedTasks
 */
export const migrateQueuedTasks = internalMutation({
  args: {},
  handler: async (ctx) => {
    const allTasks = await ctx.db.query('chatroom_tasks').collect();

    let migrated = 0;
    for (const task of allTasks) {
      const raw = task as Record<string, unknown>;
      if (raw.status === 'queued') {
        await ctx.db.patch(task._id, { status: 'pending' });
        migrated++;
      }
    }

    return { migrated };
  },
});
