import { Migrations } from '@convex-dev/migrations';

import { components, internal } from './_generated/api';
import type { DataModel, Doc } from './_generated/dataModel';
import {
  compactFileTreeDeltaOperation,
  expandFileTreeDeltaOperations,
  isVerboseFileTreeDeltaOp,
} from './lib/fileTreeDeltaOps';
import {
  isLegacyMachineFavoriteScopeKey,
  normalizeMachineFavoriteScopeKey,
} from './utils/machineFavoriteScopeKey';
import { rebuildAgentOperationalStatusForChatroom } from '../src/domain/usecase/agent/project-agent-operational-status';

type FavoriteEntry = Doc<'chatroom_machineConfigFavorites'>['favorites'][number];

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

// --- Git State Migrations ---

/**
 * Migration: Drop embedded recentCommits + hasMoreCommits from chatroom_workspaceGitState.
 * The fields were removed from the daemon write path in v1.38.3; this migration
 * cleans up legacy rows so the schema fields can eventually be deleted.
 *
 * Run via:
 *   cd services/backend && npx convex run migrations:run '{"fn":"migrations:dropEmbeddedRecentCommits"}'
 *
 * Idempotent: rows already cleaned are skipped (returns undefined = no patch).
 */
export const dropEmbeddedRecentCommits = migrations.define({
  table: 'chatroom_workspaceGitState',
  migrateOne: async (_ctx, row) => {
    const r = row as Record<string, unknown>;
    if (r.recentCommits !== undefined || r.hasMoreCommits !== undefined) {
      return { recentCommits: undefined, hasMoreCommits: undefined };
    }
  },
});

// --- Saved Commands Migrations ---

/**
 * Infer scope for rows created before the scope field existed.
 * Used only by backfillSavedCommandScope migration.
 */
export function inferLegacySavedCommandScope(row: { chatroomId?: string }): 'user' | 'chatroom' {
  return row.chatroomId ? 'chatroom' : 'user';
}

/**
 * Migration: Backfill scope field for saved commands created before the scope feature.
 * Legacy rows have no scope field — chatroomId present → 'chatroom', otherwise → 'user'.
 *
 * Run via: pnpm migrate  (included in migrations:runAll)
 *
 * Idempotent: rows with scope already set are skipped.
 */
export const backfillSavedCommandScope = migrations.define({
  table: 'chatroom_savedCommands',
  migrateOne: async (_ctx, row) => {
    if (row.scope !== undefined) return;
    return { scope: inferLegacySavedCommandScope(row) };
  },
});

/**
 * Migration: Drop embedded availableModels from chatroom_machines.
 * The field was extracted to chatroom_machineModels in v1.38.4. This migration
 * cleans up legacy rows so the heavy payload no longer rides along on
 * listMachines re-pushes.
 *
 * Run via:
 *   cd services/backend && npx convex run migrations:run '{"fn":"migrations:dropEmbeddedAvailableModels"}'
 *
 * Idempotent: rows already cleaned are skipped (returns undefined = no patch).
 */
export const dropEmbeddedAvailableModels = migrations.define({
  table: 'chatroom_machines',
  migrateOne: async (_ctx, row) => {
    const r = row as Record<string, unknown>;
    if (r.availableModels !== undefined) {
      return { availableModels: undefined };
    }
  },
});

/**
 * Migration: Set wantResume=false for duo-team builder configs.
 * Duo builder should always cold-start; UI hides the toggle.
 *
 * Usage: npx convex run migrations:run '{"fn":"migrations:setDuoBuilderWantResumeFalse"}'
 * Idempotent: rows already false are skipped.
 */
export const setDuoBuilderWantResumeFalse = migrations.define({
  table: 'chatroom_teamAgentConfigs',
  migrateOne: async (_ctx, config) => {
    if (!config.teamRoleKey.includes('#team_duo#')) return;
    if (config.role.toLowerCase() !== 'builder') return;
    if (config.wantResume === false) return;
    return { wantResume: false };
  },
});

/**
 * TEMPORARY local cleanup: delete pre-teamRoleKey machine config favorites.
 * Legacy rows stored favorites per (userId, machineId) only and block schema push.
 *
 * Usage (local dev only — NOT in runAll):
 *   cd services/backend && npx convex run migrations:run '{"fn":"migrations:deleteLegacyMachineConfigFavorites"}'
 *
 * After running, restore `teamRoleKey: v.string()` in schema.ts (remove v.optional).
 * Idempotent: rows with teamRoleKey set are skipped.
 */
export const deleteLegacyMachineConfigFavorites = migrations.define({
  table: 'chatroom_machineConfigFavorites',
  migrateOne: async (ctx, row) => {
    if (row.teamRoleKey !== undefined) return;
    await ctx.db.delete('chatroom_machineConfigFavorites', row._id);
  },
});

/**
 * Merge two arrays of machine config favorites, deduplicating by harness+model.
 * Prefers entries from `a` (primary), then appends entries from `b` not already present.
 */
function mergeMachineConfigFavorites(a: FavoriteEntry[], b: FavoriteEntry[]): FavoriteEntry[] {
  const seen = new Set<string>();
  const result: FavoriteEntry[] = [];
  for (const entry of a) {
    const key = `${entry.agentHarness}|${entry.model}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(entry);
  }
  for (const entry of b) {
    const key = `${entry.agentHarness}|${entry.model}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(entry);
  }
  return result;
}

/**
 * Migration: Convert chatroom-scoped machine config favorites to machine-scoped.
 * Legacy key format: chatroom_<id>#team_<team>#role_<role>
 * New key format:    team_<team>#role_<role>
 *
 * Merges duplicate rows for the same normalized scope (dedup by harness+model).
 *
 * Usage (add to runAll after deploy):
 *   cd services/backend && npx convex run migrations:run '{"fn":"migrations:migrateMachineConfigFavoritesToMachineScope"}'
 *
 * Idempotent: rows already in new format are skipped.
 */
export const migrateMachineConfigFavoritesToMachineScope = migrations.define({
  table: 'chatroom_machineConfigFavorites',
  migrateOne: async (ctx, row) => {
    if (!isLegacyMachineFavoriteScopeKey(row.teamRoleKey)) return;
    const newKey = normalizeMachineFavoriteScopeKey(row.teamRoleKey);

    const existing = await ctx.db
      .query('chatroom_machineConfigFavorites')
      .withIndex('by_user_machine_teamRole', (q) =>
        q.eq('userId', row.userId).eq('machineId', row.machineId).eq('teamRoleKey', newKey)
      )
      .first();

    if (existing && existing._id !== row._id) {
      const merged = mergeMachineConfigFavorites(existing.favorites, row.favorites);
      await ctx.db.patch('chatroom_machineConfigFavorites', existing._id, {
        favorites: merged,
        updatedAt: Math.max(existing.updatedAt, row.updatedAt),
      });
      await ctx.db.delete('chatroom_machineConfigFavorites', row._id);
      return;
    }

    return { teamRoleKey: newKey };
  },
});

/**
 * Migration: Seed per-user standing-instruction history from existing room instructions.
 * For each room with non-empty standingInstructions, upsert into
 * chatroom_standingInstructionHistory for room.ownerId.
 *
 * On first run: inserts distinct (ownerId, content) pairs with useCount=1.
 * Re-runs skip existing (ownerId, contentKey) pairs without bumping useCount.
 * This means if multiple rooms share the same text for one owner, it's recorded
 * once with useCount=1. Live use via upsert/recordUse increments after seeding.
 *
 * Usage: npx convex run migrations:run '{"fn":"migrations:seedStandingInstructionHistory"}'
 * Idempotent: re-run skips pairs that already exist.
 */
export const seedStandingInstructionHistory = migrations.define({
  table: 'chatroom_rooms',
  migrateOne: async (ctx, room) => {
    const content = (room.standingInstructions ?? '').trim();
    if (!content) return;
    if (content.length > 10_000) return;
    if (!room.ownerId) return;
    const contentKey = content;
    const existing = await ctx.db
      .query('chatroom_standingInstructionHistory')
      .withIndex('by_userId_contentKey', (q) =>
        q.eq('userId', room.ownerId).eq('contentKey', contentKey)
      )
      .first();
    if (existing) return;
    const now = Date.now();
    await ctx.db.insert('chatroom_standingInstructionHistory', {
      userId: room.ownerId,
      content,
      contentKey,
      useCount: 1,
      lastUsedAt: room.lastActivityAt ?? now,
      createdAt: now,
    });
  },
});

// --- Standing Instructions Title Migration ---

/**
 * Migration: Rename chatroom_rooms.standingInstructionsName to
 * chatroom_rooms.standingInstructionsTitle.
 *
 * Standing instruction titles are now required; the legacy optional name field
 * is removed. Copies any existing name into title and unsets the old field.
 *
 * Usage: npx convex run migrations:run '{"fn":"migrations:migrateStandingInstructionsNameToTitle"}'
 * Idempotent: rows without a legacy name or with title already set are skipped.
 */
export const migrateStandingInstructionsNameToTitle = migrations.define({
  table: 'chatroom_rooms',
  migrateOne: async (_ctx, room) => {
    const doc = room as Record<string, unknown>;
    const legacyName =
      typeof doc.standingInstructionsName === 'string' ? doc.standingInstructionsName.trim() : '';
    if (!legacyName) return;
    if (doc.standingInstructionsTitle) return;
    return {
      standingInstructionsTitle: legacyName,
      standingInstructionsName: undefined,
    };
  },
});

// --- Workspace File Tree Migrations ---

/**
 * Migration: Compact legacy verbose file-tree delta operations to short-key format.
 * Required after PR #1122 changed the stored schema; production rows may still use
 * {operation, path, entryType} shape.
 *
 * Run via: npx convex run migrations:run '{"fn": "migrations:compactWorkspaceFileTreeDeltaOperations"}'
 * Idempotent: rows already compact are skipped.
 */
export const compactWorkspaceFileTreeDeltaOperations = migrations.define({
  table: 'chatroom_workspaceFileTreeDelta',
  migrateOne: async (_ctx, row) => {
    if (!row.operations.some(isVerboseFileTreeDeltaOp)) return;
    return {
      operations: expandFileTreeDeltaOperations(row.operations).map(compactFileTreeDeltaOperation),
    };
  },
});

/**
 * Migration: Backfill roleNames from legacy accessLevel.
 * system_admin → ['system_admin'], all others → ['user'].
 */
export const backfillUserRoleNames = migrations.define({
  table: 'users',
  migrateOne: async (_ctx, user) => {
    if (user.roleNames !== undefined) {
      return;
    }
    const roleNames =
      user.accessLevel === 'system_admin' ? (['system_admin'] as const) : (['user'] as const);
    return { roleNames: [...roleNames] };
  },
});

/**
 * Migration: Strip legacy `manager` role from roleNames.
 * Starter now ships only `user` and `system_admin`; forks add custom roles.
 */
export const stripManagerRoleNames = migrations.define({
  table: 'users',
  migrateOne: async (_ctx, user) => {
    if (!user.roleNames?.includes('manager')) {
      return;
    }
    const filtered = user.roleNames.filter((role) => role !== 'manager');
    return { roleNames: filtered.length > 0 ? filtered : ['user'] };
  },
});

// ========================================
// Batch Runners
// ========================================

/**
 * Backfill materialized agent operational status rows from current configs.
 * Idempotent and safe to resume through the migrations component.
 */
export const backfillAgentOperationalStatus = migrations.define({
  table: 'chatroom_rooms',
  migrateOne: async (ctx, room) => {
    await rebuildAgentOperationalStatusForChatroom(
      ctx,
      room._id,
      'migration:backfillAgentOperationalStatus'
    );
  },
});

export const migrateMachineTaskStatusSignals = migrations.define({
  table: 'chatroom_timelineTaskStatusSignals',
  migrateOne: async (ctx, row) => {
    const targetMachineId = (row as { targetMachineId?: string }).targetMachineId;
    const targetRole = (row as { targetRole?: string }).targetRole;
    if (!targetMachineId || !targetRole) return;
    const existing = await ctx.db
      .query('chatroom_machineTaskStatusSignals')
      .withIndex('by_machineId_signalKey', (q) =>
        q.eq('machineId', targetMachineId).eq('signalKey', row.signalKey)
      )
      .unique();
    if (existing) return;
    await ctx.db.insert('chatroom_machineTaskStatusSignals', {
      machineId: targetMachineId,
      chatroomId: row.chatroomId,
      taskId: row.taskId,
      targetRole,
      taskStatus: row.taskStatus,
      signalKey: row.signalKey,
      taskUpdatedAt: row.taskUpdatedAt,
    });
  },
});

export const stripTimelineMachineSignalFields = migrations.define({
  table: 'chatroom_timelineTaskStatusSignals',
  migrateOne: async (_ctx, row) => {
    const r = row as { targetMachineId?: string; targetRole?: string };
    if (r.targetMachineId !== undefined || r.targetRole !== undefined) {
      return { targetMachineId: undefined, targetRole: undefined } as never;
    }
  },
});

/**
 * Migration: Strip legacy operational fields from machine task snapshots.
 * These fields were removed from the write path by the operational-status
 * projection refactor; schema tolerance remains until this migration runs.
 * Idempotent: already-clean rows are skipped.
 */
export const stripMachineAssignedTaskSnapshotOperationalFields = migrations.define({
  table: 'chatroom_machineAssignedTaskSnapshots',
  migrateOne: async (_ctx, row) => {
    const r = row as Record<string, unknown>;
    const legacyFields = ['circuitState', 'desiredState', 'spawnedAgentPid'] as const;
    const present = legacyFields.filter((field) => r[field] !== undefined);
    if (present.length === 0) return;
    return Object.fromEntries(present.map((field) => [field, undefined]));
  },
});

/**
 * Run all migrations in order.
 * Usage: pnpm migrate  (from repo root; CI uses the same command with CONVEX_DEPLOY_KEY set)
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
  internal.migrations.deleteLegacyMessageQueueDocuments,
  internal.migrations.migrateQueuedTasks,
  internal.migrations.migrateTeamRoleKeyAddTeamId,
  // Cleanup
  internal.migrations.deduplicateTeamAgentConfigs,
  internal.migrations.purgeWorkspaceCommitDetails,
  internal.migrations.migrateMachineTaskStatusSignals,
  internal.migrations.stripTimelineMachineSignalFields,
  internal.migrations.stripMachineAssignedTaskSnapshotOperationalFields,
  // Workspace File Tree
  internal.migrations.compactWorkspaceFileTreeDeltaOperations,
  // Git State
  internal.migrations.dropEmbeddedRecentCommits,
  // Machine Models
  internal.migrations.dropEmbeddedAvailableModels,
  // Saved Commands
  internal.migrations.backfillSavedCommandScope,
  // Agent Config
  internal.migrations.setDuoBuilderWantResumeFalse,
  // Machine Config Favorites
  internal.migrations.migrateMachineConfigFavoritesToMachineScope,
  // Standing Instructions History
  internal.migrations.seedStandingInstructionHistory,
  // Standing Instructions Title
  internal.migrations.migrateStandingInstructionsNameToTitle,
  // RBAC
  internal.migrations.backfillUserRoleNames,
  internal.migrations.stripManagerRoleNames,
]);
