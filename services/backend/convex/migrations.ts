import { Migrations } from '@convex-dev/migrations';

import { components, internal } from './_generated/api.js';
import type { DataModel } from './_generated/dataModel.js';

export const migrations = new Migrations<DataModel>(components.migrations);

/**
 * General-purpose runner to execute any migration by name.
 * Usage: npx convex run migrations:run '{"fn": "migrations:myMigration"}'
 */
export const run = migrations.runner();

// ========================================
// Migration Definitions
// ========================================

// --- Session & User Migrations ---

/**
 * Migration: Remove deprecated session expiration fields.
 * Sets `expiresAt` and `expiresAtLabel` to undefined on all sessions.
 */
export const unsetSessionExpiration = migrations.define({
  table: 'sessions',
  migrateOne: async (_ctx, session) => {
    if (session.expiresAt !== undefined || session.expiresAtLabel !== undefined) {
      return {
        expiresAt: undefined,
        expiresAtLabel: undefined,
      };
    }
  },
});

/**
 * Migration: Set default access level for users.
 * Sets `accessLevel` to 'user' for all users where it is undefined.
 */
export const setUserAccessLevelDefault = migrations.define({
  table: 'users',
  migrateOne: async (_ctx, user) => {
    if (user.accessLevel === undefined) {
      return {
        accessLevel: 'user' as const,
      };
    }
  },
});

// --- Machine & Agent Config Migrations ---

/**
 * Migration: Convert availableModels from string[] to Record<string, string[]>.
 * Existing machine documents written by old CLI still store a plain array.
 * Idempotent: documents already in record shape are skipped.
 */
export const migrateAvailableModelsToPerHarness = migrations.define({
  table: 'chatroom_machines',
  migrateOne: async (_ctx, machine) => {
    const raw = (machine as Record<string, unknown>).availableModels;
    if (raw === undefined || raw === null) return;
    if (!Array.isArray(raw)) return; // Already a record
    return { availableModels: { opencode: raw as string[] } };
  },
});

/**
 * Migration: Strip stale FSM fields from chatroom_participants.
 * Removes status, readyUntil, activeUntil, cleanupDeadline, statusReason, etc.
 * Idempotent: documents without stale fields are skipped.
 */
export const stripParticipantStaleFields = migrations.define({
  table: 'chatroom_participants',
  migrateOne: async (_ctx, participant) => {
    const STALE_FIELDS = [
      'status',
      'readyUntil',
      'activeUntil',
      'cleanupDeadline',
      'statusReason',
      'desiredStatus',
      'pendingCommand',
    ] as const;

    const doc = participant as Record<string, unknown>;
    const staleFieldsPresent = STALE_FIELDS.filter((f) => f in doc);
    if (staleFieldsPresent.length === 0) return;
    return Object.fromEntries(staleFieldsPresent.map((f) => [f, undefined]));
  },
});

/**
 * Migration: Delete old-format chatroom_agentPreferences documents.
 * Old format lacks agentHarness field (has harnessByRole map instead).
 * Idempotent: documents with agentHarness are skipped.
 */
export const deleteOldFormatAgentPreferences = migrations.define({
  table: 'chatroom_agentPreferences',
  migrateOne: async (ctx, pref) => {
    const raw = pref as Record<string, unknown>;
    if (raw.agentHarness === undefined) {
      await ctx.db.delete('chatroom_agentPreferences', pref._id);
    }
  },
});

/**
 * Migration: Delete pre-refactor chatroom_messageQueue documents with legacy taskId field.
 * Old documents have taskId but lack queuePosition, making them impossible to promote.
 * Idempotent: documents without taskId are skipped.
 */
export const deleteLegacyMessageQueueDocuments = migrations.define({
  table: 'chatroom_messageQueue',
  migrateOne: async (ctx, msg) => {
    const raw = msg as Record<string, unknown>;
    if (raw.taskId !== undefined) {
      await ctx.db.delete('chatroom_messageQueue', msg._id);
    }
  },
});

/**
 * Migration: Update chatroom_tasks with legacy "queued" status to "pending".
 * The "queued" status was removed in the message queue staging table refactor.
 * Idempotent: only patches documents with status="queued".
 */
export const migrateQueuedTasks = migrations.define({
  table: 'chatroom_tasks',
  migrateOne: async (_ctx, task) => {
    const raw = task as Record<string, unknown>;
    if (raw.status === 'queued') {
      return { status: 'pending' as const };
    }
  },
});

/**
 * Migration: Add teamId to teamRoleKey in chatroom_teamAgentConfigs.
 * Old format: chatroom_<chatroomId>#role_<role>
 * New format: chatroom_<chatroomId>#team_<teamId>#role_<role>
 * Idempotent: records already containing '#team_' are skipped.
 */
export const migrateTeamRoleKeyAddTeamId = migrations.define({
  table: 'chatroom_teamAgentConfigs',
  migrateOne: async (ctx, config) => {
    if (config.teamRoleKey.includes('#team_')) return; // Already migrated

    const chatroom = await ctx.db.get('chatroom_rooms', config.chatroomId);
    if (!chatroom || !chatroom.teamId) {
      await ctx.db.delete('chatroom_teamAgentConfigs', config._id);
      return;
    }

    const newKey = `chatroom_${config.chatroomId}#team_${chatroom.teamId.toLowerCase()}#role_${config.role.toLowerCase()}`;

    // Check for existing record with the new key to avoid duplicates
    const existing = await ctx.db
      .query('chatroom_teamAgentConfigs')
      .withIndex('by_teamRoleKey', (q) => q.eq('teamRoleKey', newKey))
      .first();

    if (existing) {
      // Duplicate — delete this record
      await ctx.db.delete('chatroom_teamAgentConfigs', config._id);
      return;
    }

    return { teamRoleKey: newKey };
  },
});

/**
 * Migration: Rename agent.exited stopReason values to actor-prefixed convention.
 * Idempotent: documents already using new-format values are skipped.
 */
export const migrateStopReasonToActorPrefixed = migrations.define({
  table: 'chatroom_eventStream',
  migrateOne: async (_ctx, event) => {
    const RENAME_MAP: Record<string, string> = {
      intentional_stop: 'user.stop',
      daemon_respawn_stop: 'daemon.respawn',
      process_exited_with_success: 'agent_process.exited_clean',
      process_terminated_with_signal: 'agent_process.signal',
      process_terminated_unexpectedly: 'agent_process.crashed',
    };

    const raw = event as Record<string, unknown>;
    if (raw.type !== 'agent.exited') return;

    const oldReason = raw.stopReason as string | undefined;
    if (!oldReason || !(oldReason in RENAME_MAP)) return;

    return { stopReason: RENAME_MAP[oldReason] };
  },
});

/**
 * Migration: Unify agent start/stop event reason values to actor-prefixed dot notation.
 * Idempotent: documents already using new-format values are skipped.
 */
export const migrateEventReasonsToActorPrefixed = migrations.define({
  table: 'chatroom_eventStream',
  migrateOne: async (_ctx, event) => {
    const STOP_REASON_MAP: Record<string, string> = {
      'user-stop': 'user.stop',
      'dedup-stop': 'platform.dedup',
      'team-switch': 'platform.team_switch',
    };

    const START_REASON_MAP: Record<string, string> = {
      'user-start': 'user.start',
      'user-restart': 'user.restart',
    };

    const raw = event as Record<string, unknown>;

    if (raw.type === 'agent.requestStop') {
      const oldReason = raw.reason as string | undefined;
      if (oldReason && oldReason in STOP_REASON_MAP) {
        return { reason: STOP_REASON_MAP[oldReason] } as never;
      }
    }

    if (raw.type === 'agent.requestStart') {
      const oldReason = raw.reason as string | undefined;
      if (oldReason && oldReason in START_REASON_MAP) {
        return { reason: START_REASON_MAP[oldReason] } as never;
      }
    }
  },
});

/**
 * Migration: Deduplicate chatroom_teamAgentConfigs by teamRoleKey.
 * Keeps the most recently created row per teamRoleKey and deletes duplicates.
 * Note: This uses a full-table scan approach since dedup requires grouping.
 * Idempotent: if no duplicates exist, no changes are made.
 */
export const deduplicateTeamAgentConfigs = migrations.define({
  table: 'chatroom_teamAgentConfigs',
  migrateOne: async (ctx, config) => {
    // Check if a newer document with the same teamRoleKey exists
    const allWithKey = await ctx.db
      .query('chatroom_teamAgentConfigs')
      .withIndex('by_teamRoleKey', (q) => q.eq('teamRoleKey', config.teamRoleKey))
      .collect();

    if (allWithKey.length <= 1) return; // No duplicates

    // Sort by _creationTime descending — keep the newest
    allWithKey.sort((a, b) => b._creationTime - a._creationTime);
    const newest = allWithKey[0];

    if (config._id !== newest._id) {
      await ctx.db.delete('chatroom_teamAgentConfigs', config._id);
    }
  },
});

/**
 * Migration: Purge all rows from chatroom_workspaceCommitDetail.
 * Required before deploying schema change that adds the `status` discriminated union.
 * Idempotent: safe to run multiple times.
 */
export const purgeWorkspaceCommitDetails = migrations.define({
  table: 'chatroom_workspaceCommitDetail',
  migrateOne: async (ctx, row) => {
    await ctx.db.delete('chatroom_workspaceCommitDetail', row._id);
  },
});

/**
 * Migration: Purge all v1 workspace file tree records.
 * Run before removing compression fields from v1 schema.
 * Usage: npx convex run migrations:run '{"fn": "migrations:purgeWorkspaceFileTree"}'
 */
export const purgeWorkspaceFileTree = migrations.define({
  table: 'chatroom_workspaceFileTree',
  migrateOne: async (ctx, row) => {
    await ctx.db.delete('chatroom_workspaceFileTree', row._id);
  },
});

/**
 * Migration: Purge all v1 workspace full diff records.
 * Run before removing compression fields from v1 schema.
 * Usage: npx convex run migrations:run '{"fn": "migrations:purgeWorkspaceFullDiff"}'
 */
export const purgeWorkspaceFullDiff = migrations.define({
  table: 'chatroom_workspaceFullDiff',
  migrateOne: async (ctx, row) => {
    await ctx.db.delete('chatroom_workspaceFullDiff', row._id);
  },
});

/**
 * Migration: Purge all v1 workspace file content records.
 * Run before removing compression fields from v1 schema.
 * Usage: npx convex run migrations:run '{"fn": "migrations:purgeWorkspaceFileContent"}'
 */
export const purgeWorkspaceFileContent = migrations.define({
  table: 'chatroom_workspaceFileContent',
  migrateOne: async (ctx, row) => {
    await ctx.db.delete('chatroom_workspaceFileContent', row._id);
  },
});

// --- Saved Commands Migrations ---

/**
 * Migration: Backfill `type: 'prompt'` on legacy chatroom_savedCommands rows.
 * Required by the discriminated-union schema introduced in v1.34.0 (#410).
 * Idempotent: rows already carrying `type` are skipped.
 */
export const backfillSavedCommandType = migrations.define({
  table: 'chatroom_savedCommands',
  migrateOne: async (_ctx, command) => {
    const raw = command as unknown as { type?: string };
    if (raw.type !== undefined) return; // Already migrated
    return { type: 'prompt' as const };
  },
});

// ========================================
// Batch Runners
// ========================================

/**
 * Run all migrations in order.
 * Usage: npx convex run migrations:runAll
 *
 * Migrations are run sequentially. Each migration tracks its own progress —
 * if interrupted, it will resume from where it left off on the next run.
 */
export const runAll = migrations.runner([
  // Session & User
  internal.migrations.unsetSessionExpiration,
  internal.migrations.setUserAccessLevelDefault,
  // Machine & Agent Config
  internal.migrations.migrateAvailableModelsToPerHarness,
  internal.migrations.stripParticipantStaleFields,
  internal.migrations.deleteOldFormatAgentPreferences,
  internal.migrations.deleteLegacyMessageQueueDocuments,
  internal.migrations.migrateQueuedTasks,
  internal.migrations.migrateTeamRoleKeyAddTeamId,
  // Event Stream
  internal.migrations.migrateStopReasonToActorPrefixed,
  internal.migrations.migrateEventReasonsToActorPrefixed,
  // Cleanup
  internal.migrations.deduplicateTeamAgentConfigs,
  internal.migrations.purgeWorkspaceCommitDetails,
  // Saved Commands
  internal.migrations.backfillSavedCommandType,
]);
