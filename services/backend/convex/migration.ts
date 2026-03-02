/** Internal mutations for one-off data migrations, triggered manually from the Convex dashboard. */

import { internalMutation } from './_generated/server';

// ============================================================================
// PENDING MIGRATIONS — Run these after deploying to production
// ============================================================================

/** Converts availableModels from a flat string[] to a per-harness record on chatroom_machines documents. */
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

/** Removes stale FSM fields (status, readyUntil, etc.) from chatroom_participants documents. */
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

/** No-op migration kept for history — the status field and idle state were removed. */
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

/** Deletes old-format chatroom_agentPreferences documents that use the deprecated per-chatroom shape. */
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
