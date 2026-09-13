import { Migrations, type MigrationFunctionReference } from '@convex-dev/migrations';

import { components, internal } from './_generated/api';
import type { DataModel, Doc } from './_generated/dataModel';
import { query } from './_generated/server';
import {
  compactFileTreeDeltaOperation,
  expandFileTreeDeltaOperations,
  isVerboseFileTreeDeltaOp,
} from './lib/fileTreeDeltaOps';
import {
  isLegacyMachineFavoriteScopeKey,
  normalizeMachineFavoriteScopeKey,
} from './utils/machineFavoriteScopeKey';
import type { AgentHarness } from '../src/domain/entities/agent';
import { migrateFavoriteModelForHarness } from '../src/domain/entities/harness/model-provider';
import { isActiveWorkspace } from '../src/domain/entities/workspace';
import { getTeamStructure } from '../src/domain/entities/team-presets';
import { upsertActiveTeamStructure } from '../src/domain/usecase/team/active-team-structure';
import {
  upsertMessageReadModel,
  ensureMessageReadModelState,
} from '../src/domain/usecase/message/message-read-model';
import { rebuildObservedWorkspaceView } from '../src/domain/usecase/workspace/project-observed-workspace-view';

type FavoriteEntry = Doc<'chatroom_machineConfigFavorites'>['favorites'][number];
type HarnessModelFavorite = { agentHarness: AgentHarness; model: string };

export const migrations = new Migrations<DataModel>(components.migrations);

/**
 * Convex migrations use explicit `undefined` values to delete legacy fields.
 * Keep that deletion contract at this API boundary while the application uses
 * exact optional property types everywhere else.
 */
function migrationPatch<T>(patch: Record<string, unknown>): Partial<T> {
  return patch as unknown as Partial<T>;
}

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
      return migrationPatch<Doc<'sessions'>>({
        expiresAt: undefined,
        expiresAtLabel: undefined,
      });
    }
  },
});

/**
 * Migration: Remove the deprecated CLI session expiration field.
 * CLI sessions are non-expiring and remain valid until explicitly revoked.
 */
export const unsetCliSessionExpiration = migrations.define({
  table: 'cliSessions',
  migrateOne: async (_ctx, cliSession) => {
    if (cliSession.expiresAt !== undefined) {
      return migrationPatch<Doc<'cliSessions'>>({ expiresAt: undefined });
    }
  },
});

/**
 * Migration: Remove the obsolete connectivity flag from chatroom_machines.
 * Connectivity is maintained in the thin machine status/liveness tables.
 */
export const unsetMachineDaemonConnected = migrations.define({
  table: 'chatroom_machines',
  migrateOne: async (_ctx, machine) => {
    if ((machine as Record<string, unknown>).daemonConnected !== undefined) {
      return migrationPatch<Doc<'chatroom_machines'>>({ daemonConnected: undefined });
    }
  },
});

/**
 * Migration: Remove daemon connectivity from the agent/role read model.
 * Connectivity is a machine-level UI concern, not role projection state.
 */
export const unsetAgentRoleDaemonConnected = migrations.define({
  table: 'chatroom_agentRoleStatusReadModel',
  migrateOne: async (_ctx, row) => {
    if ((row as Record<string, unknown>).daemonConnected !== undefined) {
      return migrationPatch<Doc<'chatroom_agentRoleStatusReadModel'>>({
        daemonConnected: undefined,
      });
    }
  },
});

/** Remove the redundant connectivity flag from the thin liveness read model. */
export const unsetMachineLivenessDaemonConnected = migrations.define({
  table: 'chatroom_machineLiveness',
  migrateOne: async (_ctx, row) => {
    if ((row as Record<string, unknown>).daemonConnected !== undefined) {
      return migrationPatch<Doc<'chatroom_machineLiveness'>>({ daemonConnected: undefined });
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

// --- Last-at projections ---
// Compatibility phase: the legacy parent fields remain optional schema
// validators and retained stored values are migration inputs only. Runtime
// callers use the projection tables. Keep these validators/values until all
// environments have completed the registered backfills; a later release may
// then remove the fields after that rollout gate.
// Each backfill only advances its projection row and never patches a legacy
// field. Safe to rerun: an existing newer projection value is preserved
// (Math.max semantics). Once all environments have run these, they become
// no-ops.

/** Historical stored shape of cliSessions before lastUsedAt removal. */
type LegacyCliSessionTimestamp = { lastUsedAt?: number };
/** Historical stored shape of sessions before lastActivityAt removal. */
type LegacySessionTimestamp = { lastActivityAt?: number };
/** Historical stored shape of chatroom_machines before lastSeenAt removal. */

/**
 * Backfill chatroom_cliSessionLastUsedAt from the historical
 * cliSessions.lastUsedAt stored value. Rows without the historical field
 * are skipped.
 * Idempotent: only advances the projection when the source value is newer.
 */
export const backfillCliSessionLastUsedAt = migrations.define({
  table: 'cliSessions',
  migrateOne: async (ctx, cliSession) => {
    const timestamp = (cliSession as typeof cliSession & LegacyCliSessionTimestamp).lastUsedAt;
    if (timestamp === undefined) return;
    const existing = await ctx.db
      .query('chatroom_cliSessionLastUsedAt')
      .withIndex('by_cliSessionId', (q) => q.eq('cliSessionId', cliSession._id))
      .first();
    if (!existing) {
      await ctx.db.insert('chatroom_cliSessionLastUsedAt', {
        cliSessionId: cliSession._id,
        lastUsedAt: timestamp,
      });
    } else if (timestamp > existing.lastUsedAt) {
      await ctx.db.patch('chatroom_cliSessionLastUsedAt', existing._id, {
        lastUsedAt: timestamp,
      });
    }
  },
});

/**
 * Backfill chatroom_sessionLastActivityAt from the historical
 * sessions.lastActivityAt stored value.
 * Sessions without the historical field produce no projection row.
 * Idempotent: only advances the projection when the source value is newer.
 */
export const backfillSessionLastActivityAt = migrations.define({
  table: 'sessions',
  migrateOne: async (ctx, session) => {
    const timestamp = (session as typeof session & LegacySessionTimestamp).lastActivityAt;
    if (timestamp === undefined) return;
    const existing = await ctx.db
      .query('chatroom_sessionLastActivityAt')
      .withIndex('by_sessionId', (q) => q.eq('sessionId', session._id))
      .first();
    if (!existing) {
      await ctx.db.insert('chatroom_sessionLastActivityAt', {
        sessionId: session._id,
        lastActivityAt: timestamp,
      });
    } else if (timestamp > existing.lastActivityAt) {
      await ctx.db.patch('chatroom_sessionLastActivityAt', existing._id, {
        lastActivityAt: timestamp,
      });
    }
  },
});

/**
 * Migration: Strip stale fields from chatroom_participants.
 * Removes status, desired-state, lifecycle, and token-activity mirrors from
 * participants. Agent lifecycle status is daemon-owned and projected through
 * chatroom_agentRoleStatusReadModel.
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
      'lastInFlightTaskId',
      'lastSeenTokenAt',
      'lastStatus',
      'lastDesiredState',
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
      return migrationPatch<Doc<'chatroom_workspaceGitState'>>({
        recentCommits: undefined,
        hasMoreCommits: undefined,
      });
    }
  },
});

// --- Saved Commands Migrations ---

/**
 * Infer scope for rows created before the scope field existed.
 * Used only by backfillSavedCommandScope migration.
 */
export function inferLegacySavedCommandScope(row: {
  chatroomId?: string | undefined;
}): 'user' | 'chatroom' {
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

export const migrateEnhancerJobOriginToTask = migrations.define({
  table: 'chatroom_enhancerJobs',
  migrateOne: async (ctx, job) => {
    if (!job.taskId || !job.originUserMessageId) return;
    const task = await ctx.db.get('chatroom_tasks', job.taskId);
    if (!task || task.originUserMessageId) return;
    await ctx.db.patch('chatroom_tasks', job.taskId, {
      originUserMessageId: job.originUserMessageId,
    });
  },
});

export const migrateTaskEnhancerEnabledSnapshot = migrations.define({
  table: 'chatroom_tasks',
  migrateOne: async (_ctx, task) => {
    if (task.enhancerEnabledAtEnqueue !== undefined || task.plannerEnhancerEnabled === undefined)
      return;
    return { enhancerEnabledAtEnqueue: task.plannerEnhancerEnabled };
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

function rewriteAndDedupeFavorites<T extends HarnessModelFavorite>(favorites: T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const entry of favorites) {
    const model = migrateFavoriteModelForHarness(entry.agentHarness, entry.model);
    const key = `${entry.agentHarness}|${model}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ ...entry, model });
  }
  return result;
}

function favoritesNeedModelPrefixMigration<T extends HarnessModelFavorite>(
  favorites: T[]
): boolean {
  return favorites.some(
    (favorite) =>
      migrateFavoriteModelForHarness(favorite.agentHarness, favorite.model) !== favorite.model
  );
}

/**
 * Migration: Rewrite stale machine config favorite model ids to provider-prefixed ids.
 * Idempotent: rows whose favorites already use provider prefixes are skipped.
 */
export const migrateMachineConfigFavoriteModelPrefixes = migrations.define({
  table: 'chatroom_machineConfigFavorites',
  migrateOne: async (_ctx, row) => {
    if (!favoritesNeedModelPrefixMigration(row.favorites)) return;
    return {
      favorites: rewriteAndDedupeFavorites(row.favorites),
      updatedAt: Date.now(),
    };
  },
});

/**
 * Migration: Rewrite stale enhancer config favorite model ids to provider-prefixed ids.
 * Idempotent: rows whose favorites already use provider prefixes are skipped.
 */
export const migrateEnhancerConfigFavoriteModelPrefixes = migrations.define({
  table: 'chatroom_enhancerConfigFavorites',
  migrateOne: async (_ctx, row) => {
    if (!favoritesNeedModelPrefixMigration(row.favorites)) return;
    return {
      favorites: rewriteAndDedupeFavorites(row.favorites),
      updatedAt: Date.now(),
    };
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
 * Migration: Backfill legacy workspaces as opted out of file-tree synchronization.
 * Idempotent: workspaces with an explicit setting are left unchanged.
 */
export const backfillWorkspaceFileTreeSyncDisabled = migrations.define({
  table: 'chatroom_workspaces',
  migrateOne: async (_ctx, workspace) => {
    if (workspace.fileTreeSyncEnabled !== undefined) return;
    return { fileTreeSyncEnabled: false };
  },
});

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
    return migrationPatch<Doc<'chatroom_workspaceFileTreeDelta'>>({
      operations: expandFileTreeDeltaOperations(row.operations).map(compactFileTreeDeltaOperation),
    });
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

/** Backfill the active static team assignment before legacy room fields are removed. */
export const backfillActiveTeamStructures = migrations.define({
  table: 'chatroom_rooms',
  migrateOne: async (ctx, room) => {
    const existing = await ctx.db
      .query('chatroom_activeTeamStructures')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', room._id))
      .first();
    if (existing) return;

    const legacyTeamId = (room as typeof room & { teamId?: string }).teamId;
    const structure = getTeamStructure({ teamId: legacyTeamId ?? 'duo' });
    await upsertActiveTeamStructure(ctx, {
      chatroomId: room._id,
      teamStructureId: structure.teamStructureId,
      updatedBy: room.ownerId,
    });
  },
});

export const backfillMachineObservedWorkspaceViews = migrations.define({
  table: 'chatroom_machines',
  migrateOne: async (ctx, machine) => {
    const workspaces = await ctx.db
      .query('chatroom_workspaces')
      .withIndex('by_machine', (q) => q.eq('machineId', machine.machineId))
      .collect();
    const chatroomIds = [
      ...new Set(
        workspaces.filter((ws) => isActiveWorkspace(ws.removedAt)).map((ws) => ws.chatroomId)
      ),
    ];
    for (const chatroomId of chatroomIds)
      await rebuildObservedWorkspaceView(ctx, machine.machineId, chatroomId);
  },
});

export const backfillMessageReadModels = migrations.define({
  table: 'chatroom_messages',
  migrateOne: async (ctx, message) => {
    await upsertMessageReadModel(ctx, message);
  },
});

export const backfillMessageReadModelState = migrations.define({
  table: 'chatroom_rooms',
  migrateOne: async (ctx, room) => {
    await ensureMessageReadModelState(ctx, room._id);
  },
});

// ========================================
// Batch Runners
// ========================================

/**
 * Backfill materialized agent operational status rows from current configs.
 * Idempotent and safe to resume through the migrations component.
 */
/** Seed one deterministic primary workspace for existing chatrooms. */
export const backfillPrimaryWorkspaceForChatroom = migrations.define({
  table: 'chatroom_workspaces',
  migrateOne: async (ctx, workspace) => {
    if (workspace.removedAt !== undefined) return;

    const existing = await ctx.db
      .query('chatroom_primaryWorkspaces')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', workspace.chatroomId))
      .first();
    if (existing) return;

    const activeWorkspaces = await ctx.db
      .query('chatroom_workspaces')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', workspace.chatroomId))
      .filter((q) => q.eq(q.field('removedAt'), undefined))
      .collect();
    const newest = activeWorkspaces.slice().sort((a, b) => b.registeredAt - a.registeredAt)[0];
    if (!newest || newest._id !== workspace._id) return;

    await ctx.db.insert('chatroom_primaryWorkspaces', {
      chatroomId: workspace.chatroomId,
      workspaceId: workspace._id,
      updatedAt: Date.now(),
    });
  },
});

export const stripTimelineMachineSignalFields = migrations.define({
  table: 'chatroom_timelineTaskStatusSignals',
  migrateOne: async (_ctx, row) => {
    const r = row as { targetMachineId?: string | undefined; targetRole?: string | undefined };
    if (r.targetMachineId !== undefined || r.targetRole !== undefined) {
      return { targetMachineId: undefined, targetRole: undefined } as never;
    }
  },
});

/** Purge legacy direct-harness rows before their tables are removed from schema. */
export const purgeHarnessSessionMessages = migrations.define({
  table: 'chatroom_harnessSessionMessages' as never,
  migrateOne: async (ctx, row) => {
    await ctx.db.delete(
      'chatroom_harnessSessionMessages' as never,
      (row as unknown as { _id: string })._id as never
    );
  },
});

export const purgeHarnessMessageQueue = migrations.define({
  table: 'chatroom_harnessMessageQueue' as never,
  migrateOne: async (ctx, row) => {
    await ctx.db.delete(
      'chatroom_harnessMessageQueue' as never,
      (row as unknown as { _id: string })._id as never
    );
  },
});

export const purgeHarnessSessionTurns = migrations.define({
  table: 'chatroom_harnessSessionTurns' as never,
  migrateOne: async (ctx, row) => {
    await ctx.db.delete(
      'chatroom_harnessSessionTurns' as never,
      (row as unknown as { _id: string })._id as never
    );
  },
});

export const purgeHarnessSessions = migrations.define({
  table: 'chatroom_harnessSessions' as never,
  migrateOne: async (ctx, row) => {
    await ctx.db.delete(
      'chatroom_harnessSessions' as never,
      (row as unknown as { _id: string })._id as never
    );
  },
});

export const purgeDirectHarnessCommands = migrations.define({
  table: 'chatroom_directHarnessCommands' as never,
  migrateOne: async (ctx, row) => {
    await ctx.db.delete(
      'chatroom_directHarnessCommands' as never,
      (row as unknown as { _id: string })._id as never
    );
  },
});

/** Purge retired task-status signal rows before their table is removed from schema. */
export const purgeMachineTaskStatusSignals = migrations.define({
  table: 'chatroom_machineTaskStatusSignals' as never,
  migrateOne: async (ctx, row) => {
    await ctx.db.delete(
      'chatroom_machineTaskStatusSignals' as never,
      (row as unknown as { _id: string })._id as never
    );
  },
});

/** Purge retired task-status signal heads before their table is removed from schema. */
export const purgeMachineTaskStatusSignalHeads = migrations.define({
  table: 'chatroom_machineTaskStatusSignalHeads' as never,
  migrateOne: async (ctx, row) => {
    await ctx.db.delete(
      'chatroom_machineTaskStatusSignalHeads' as never,
      (row as unknown as { _id: string })._id as never
    );
  },
});

/**
 * Run all migrations in order.
 * Usage: pnpm migrate  (from repo root; CI uses the same command with CONVEX_DEPLOY_KEY set)
 *
 * Migrations are run sequentially. Each migration tracks its own progress —
 * if interrupted, it will resume from where it left off on the next run.
 */
const allMigrationReferences = [
  // Session & User
  internal.migrations.unsetSessionExpiration,
  internal.migrations.unsetCliSessionExpiration,
  internal.migrations.unsetMachineDaemonConnected,
  internal.migrations.unsetAgentRoleDaemonConnected,
  internal.migrations.unsetMachineLivenessDaemonConnected,
  internal.migrations.setUserAccessLevelDefault,
  // Last-at projections
  internal.migrations.backfillCliSessionLastUsedAt,
  internal.migrations.backfillSessionLastActivityAt,
  // Machine & Agent Config
  internal.migrations.stripParticipantStaleFields,
  internal.migrations.deleteLegacyMessageQueueDocuments,
  internal.migrations.migrateQueuedTasks,
  // Cleanup
  internal.migrations.purgeWorkspaceCommitDetails,
  internal.migrations.stripTimelineMachineSignalFields,
  // Workspace File Tree
  internal.migrations.backfillWorkspaceFileTreeSyncDisabled,
  internal.migrations.compactWorkspaceFileTreeDeltaOperations,
  // Git State
  internal.migrations.dropEmbeddedRecentCommits,
  // Saved Commands
  internal.migrations.backfillSavedCommandScope,
  internal.migrations.migrateEnhancerJobOriginToTask,
  internal.migrations.migrateTaskEnhancerEnabledSnapshot,
  // Machine Config Favorites
  internal.migrations.migrateMachineConfigFavoritesToMachineScope,
  internal.migrations.migrateMachineConfigFavoriteModelPrefixes,
  internal.migrations.migrateEnhancerConfigFavoriteModelPrefixes,
  // Standing Instructions History
  internal.migrations.seedStandingInstructionHistory,
  // Standing Instructions Title
  internal.migrations.migrateStandingInstructionsNameToTitle,
  // RBAC
  internal.migrations.backfillUserRoleNames,
  internal.migrations.stripManagerRoleNames,
  internal.migrations.backfillActiveTeamStructures,
  internal.migrations.backfillMachineObservedWorkspaceViews,
  internal.migrations.backfillPrimaryWorkspaceForChatroom,
  internal.migrations.backfillMessageReadModels,
  internal.migrations.backfillMessageReadModelState,
  // Direct-harness data purge (children before parents, then command rows)
  internal.migrations.purgeHarnessSessionMessages,
  internal.migrations.purgeHarnessMessageQueue,
  internal.migrations.purgeHarnessSessionTurns,
  internal.migrations.purgeHarnessSessions,
  internal.migrations.purgeDirectHarnessCommands,
  // Retired task-status signal data purge (rows before heads is irrelevant here;
  // both tables are independent, purged after all readers/writers are gone)
  internal.migrations.purgeMachineTaskStatusSignals,
  internal.migrations.purgeMachineTaskStatusSignalHeads,
] as unknown as MigrationFunctionReference[];

export const runAll = migrations.runner(allMigrationReferences);

/**
 * Returns status for the migrations in the current, ordered migration plan.
 *
 * This is intentionally scoped to `allMigrationReferences` rather than
 * returning every migration known to the component, since old migrations may
 * have been removed from the plan but remain in the component's history.
 * The one-off migration script uses this to report and poll only the work in
 * the current plan.
 */
export const getRunAllStatus = query({
  args: {},
  handler: async (ctx) => {
    // @convex-dev/migrations returns explicitly named statuses newest-first;
    // expose the same oldest-first order used by runAll's serial plan.
    const statuses = await migrations.getStatus(ctx, {
      migrations: allMigrationReferences,
    });
    return statuses.reverse();
  },
});
