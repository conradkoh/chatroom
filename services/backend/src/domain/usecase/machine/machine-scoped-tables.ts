/**
 * Machine-scoped data registry and batched purge runner.
 *
 * This module is the single source of truth for "what data belongs to a machine".
 * When a machine is deleted, every table listed in `MACHINE_SCOPED_TABLES` is purged
 * in budgeted batches; `chatroom_workspaces` is soft-detached instead of deleted.
 * Any table with a top-level `machineId` field must be either registered here or
 * listed in `MACHINE_SCOPED_EXEMPTIONS` — the companion spec enforces that
 * invariant against `convex/schema.ts`.
 *
 * ## Budgeting
 *
 * Convex caps a mutation at a fixed amount of document read/write work. Each
 * descriptor declares a `cost`: `1` for small rows and `15` for rows that can be
 * hundreds of KB (gzip blobs, shards, diffs, file content, command runs). A batch
 * stops before the budget is exhausted and reports `drained: false` so the caller
 * schedules the next batch. `drained: true` means every descriptor returned fewer
 * rows than it asked for — i.e. the machine's data (and the detached workspaces)
 * is gone.
 *
 * ## Ordering
 *
 * `purgeMachineBatch` detaches workspaces first, then walks the registry in the
 * order declared below. `chatroom_machines` is deleted by `machines.deleteMachine`
 * before the first purge batch; its descriptor is a guarded safety net that only
 * deletes the row while the latest tombstone is still `purging`, so a machine
 * re-registered after a completed deletion is never touched.
 */

import type { Id, TableNames } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';

/** Document-work budget for one purge batch (Convex caps a mutation at ~300 units). */
export const MACHINE_PURGE_BUDGET = 300;

/** Budget charged per detached workspace (patch + optional primary-pointer delete + lookup). */
const WORKSPACE_DETACH_COST = 3;

export interface PurgeKey {
  machineId: string;
  userId: Id<'users'>;
}

/** Rows are only ever referenced by id; the registry never reads field values. */
type PurgeRowRef = { _id: Id<TableNames> };

export interface MachineScopedTable {
  table: TableNames;
  /** 1 = small row; 15 = row that can be hundreds of KB (blobs, shards, diffs, file content, command runs). */
  cost: 1 | 15;
  /** Reads up to `limit` rows via an index whose first field is machineId. */
  take: (ctx: MutationCtx, key: PurgeKey, limit: number) => Promise<PurgeRowRef[]>;
  /** Optional: replaces ctx.db.delete. Returns writes used and whether the row itself was removed (false = more work next batch). */
  deleteRow?: (ctx: MutationCtx, row: PurgeRowRef) => Promise<{ writes: number; removed: boolean }>;
}

/** Tables with a top-level machineId field intentionally NOT purged by the registry, with the reason. */
export const MACHINE_SCOPED_EXEMPTIONS: Record<string, string> = {
  chatroom_machineDeletions:
    'Deletion tombstone itself; retained for idempotent repeats, the register guard and the sweeper (purged only by retention).',
  chatroom_workspaces:
    'Soft-detached by detachActiveWorkspaces; rows kept with removedAt (same as workspaces.removeWorkspace).',
  chatroom_participants: 'Chatroom-owned optional reference; chatrooms are preserved.',
  chatroom_commandRunTailsV2:
    'No machine index; deleted through the chatroom_commandRunsV2 deleteRow (per run).',
};

interface IndexRangeBuilder {
  eq: (field: string, value: unknown) => IndexRangeBuilder;
}

interface MachineIndexedQuery {
  withIndex: (
    indexName: string,
    range: (q: IndexRangeBuilder) => IndexRangeBuilder
  ) => { take: (limit: number) => Promise<PurgeRowRef[]> };
}

/**
 * Build a descriptor that reads rows through an index whose leading fields are
 * `machineId` (or `userId` + `machineId` for user-scoped favorites).
 *
 * The single `as never` cast lives here: the runtime index name is a string
 * parameter, so the table's generated index union cannot be expressed statically.
 * The spec calls every descriptor against an empty database, which proves each
 * (table, index) pair exists at runtime.
 */
function byMachine<T extends TableNames>(
  table: T,
  indexName: string,
  cost: 1 | 15 = 1,
  userScoped = false
): MachineScopedTable {
  return {
    table,
    cost,
    take: (ctx, key, limit) =>
      (ctx.db.query(table) as never as MachineIndexedQuery)
        .withIndex(indexName, (q) =>
          userScoped
            ? q.eq('userId', key.userId).eq('machineId', key.machineId)
            : q.eq('machineId', key.machineId)
        )
        .take(limit),
  };
}

/**
 * `chatroom_machines` is normally deleted before the first purge batch. This
 * descriptor is a safety net for restart paths, and refuses to delete the row
 * unless the latest tombstone is still `purging` (a completed tombstone means a
 * new registration may legitimately own the same machineId).
 */
const machinesTable: MachineScopedTable = {
  table: 'chatroom_machines',
  cost: 1,
  take: async (ctx, key, limit) => {
    if (limit <= 0) return [];
    const deletion = await ctx.db
      .query('chatroom_machineDeletions')
      .withIndex('by_machineId', (q) => q.eq('machineId', key.machineId))
      .order('desc')
      .first();
    if (deletion?.status !== 'purging') return [];
    return ctx.db
      .query('chatroom_machines')
      .withIndex('by_machineId', (q) => q.eq('machineId', key.machineId))
      .take(1);
  },
};

/**
 * Command runs own two satellite tables. Chunks are drained in pages of 200 so a
 * single large run does not blow the mutation budget; the run row (and its live
 * tail) is only removed once its chunks are gone.
 */
const commandRunsTable: MachineScopedTable = {
  table: 'chatroom_commandRunsV2',
  cost: 15,
  take: byMachine('chatroom_commandRunsV2', 'by_machine_workingDir', 15).take,
  deleteRow: async (ctx, row) => {
    const runId = row._id as Id<'chatroom_commandRunsV2'>;
    const chunks = await ctx.db
      .query('chatroom_commandOutputV2')
      .withIndex('by_runId_chunkIndex', (q) => q.eq('runId', runId))
      .take(200);
    for (const chunk of chunks) {
      await ctx.db.delete('chatroom_commandOutputV2', chunk._id);
    }
    if (chunks.length === 200) return { writes: chunks.length, removed: false };

    let writes = chunks.length;
    const tail = await ctx.db
      .query('chatroom_commandRunTailsV2')
      .withIndex('by_runId', (q) => q.eq('runId', runId))
      .first();
    if (tail) {
      await ctx.db.delete('chatroom_commandRunTailsV2', tail._id);
      writes++;
    }
    await ctx.db.delete('chatroom_commandRunsV2', runId);
    return { writes: writes + 1, removed: true };
  },
};

/**
 * Machine-keyed tables in purge order: identity/status, inbox and agent state,
 * request tables, git state, file trees, file content, then commands.
 */
export const MACHINE_SCOPED_TABLES: readonly MachineScopedTable[] = [
  // Identity / status projections written by daemons and crons.
  byMachine('chatroom_machineStatus', 'by_machineId'),
  byMachine('chatroom_machineLiveness', 'by_machineId'),
  byMachine('chatroom_machineCapabilities', 'by_machineId'),
  byMachine('chatroom_machineAvailableModels', 'by_machineId'),
  byMachine('chatroom_machineModelFilters', 'by_machine_harness'),
  byMachine('chatroom_machineCommandInbox', 'by_machine_status_deadline'),
  machinesTable,

  // Inboxes and agent state.
  byMachine('chatroomWorkspaceTaskInbox', 'by_machine_status_createdAt'),
  byMachine('chatroomWorkspaceAgentConfigInbox', 'by_machine_status_createdAt'),
  byMachine('chatroom_agentLastSentLaunchRequests', 'by_machineId'),
  byMachine('chatroom_agentDesiredConfigs', 'by_machineId'),
  byMachine('chatroom_agentRuntimeStates', 'by_machineId'),
  byMachine('chatroom_agentRoleStatusReadModel', 'by_machineId'),
  byMachine('chatroom_agentRestartMetrics', 'by_machine_role_hour'),
  byMachine('chatroom_connectionCloseRequests', 'by_machineId'),
  byMachine('chatroom_machineObservedWorkspaceViews', 'by_machineId'),
  byMachine('chatroom_machineFileTreeReleaseHeads', 'by_machineId'),

  // Per-user favorites scoped to a machine.
  byMachine('chatroom_searchConfigFavorites', 'by_user_machine', 1, true),
  byMachine('chatroom_machineConfigFavorites', 'by_user_machine_teamRole', 1, true),

  // Request tables (their by_machineId indexes exist only for this purge).
  byMachine('chatroom_folderPickerRequests', 'by_machineId'),
  byMachine('chatroom_gitCloneRequests', 'by_machineId'),
  byMachine('chatroom_capabilities_refresh_machine_results', 'by_machineId'),

  // Git state.
  byMachine('chatroom_workspaceGitState', 'by_machine_workingDir'),
  byMachine('chatroom_workspaceGitHead', 'by_machine_workingDir'),
  byMachine('chatroom_workspaceGitWorktree', 'by_machine_workingDir'),
  byMachine('chatroom_workspaceGitUpstream', 'by_machine_workingDir'),
  byMachine('chatroom_workspaceGitRemotes', 'by_machine_workingDir'),
  byMachine('chatroom_workspaceGitPullRequests', 'by_machine_workingDir'),
  byMachine('chatroom_workspaceGitChecks', 'by_machine_workingDir'),
  byMachine('chatroom_workspaceAllPullRequests', 'by_machine_workingDir'),
  byMachine('chatroom_workspaceRecentCommits', 'by_machine_workingDir'),
  byMachine('chatroom_workspaceDiffRequests', 'by_machine_status'),
  byMachine('chatroom_workspacePRCommits', 'by_machine_workingDir_prNumber'),
  byMachine('chatroom_workspaceFullDiff', 'by_machine_workingDir', 15),
  byMachine('chatroom_workspaceFullDiffV2', 'by_machine_workingDir', 15),
  byMachine('chatroom_workspacePRDiffs', 'by_machine_workingDir', 15),
  byMachine('chatroom_workspaceCommitDetail', 'by_machine_workingDir_sha', 15),
  byMachine('chatroom_workspaceCommitDetailV2', 'by_machine_workingDir_sha', 15),

  // File trees and listings.
  byMachine('chatroom_workspaceFileTree', 'by_machine_workingDir', 15),
  byMachine('chatroom_workspaceFileTreeV2', 'by_machine_workingDir', 15),
  byMachine('chatroom_workspaceFileTreeCheckpointV2', 'by_machine_workingDir', 15),
  byMachine('chatroom_workspaceFileTreeShardV3', 'by_machine_workingDir_syncGeneration', 15),
  byMachine('chatroom_workspaceFileTreeManifestV3', 'by_machine_workingDir'),
  byMachine('chatroom_workspaceFileTreeDelta', 'by_machine_workingDir_revision'),
  byMachine('chatroom_workspaceFileTreeDeltaOperation', 'by_machine_workingDir_operationId'),
  byMachine('chatroom_workspaceFileTreeRequests', 'by_machine_status'),
  byMachine('chatroom_workspaceFileTreeReleaseRequests', 'by_machine_status'),
  byMachine('chatroom_workspaceFileTreeWatches', 'by_machine_workingDir'),
  byMachine('chatroom_workspaceDirListingV2', 'by_machine_workingDir_dirPath'),
  byMachine('chatroom_workspaceDirListingRequests', 'by_machine_status'),
  byMachine('chatroom_workspaceDirListingWatch', 'by_machine_workingDir'),
  byMachine('chatroom_workspaceFileSearchV2', 'by_machine_workingDir_query'),
  byMachine('chatroom_workspaceFileSearchRequests', 'by_machine_status'),

  // File content.
  byMachine('chatroom_workspaceFileContent', 'by_machine_workingDir_path', 15),
  byMachine('chatroom_workspaceFileContentV2', 'by_machine_workingDir_path', 15),
  byMachine('chatroom_workspaceFileContentRequests', 'by_machine_status'),
  byMachine('chatroom_workspaceFileWriteRequests', 'by_machine_status'),

  // Commands.
  byMachine('chatroom_runnableCommands', 'by_machine_workingDir'),
  commandRunsTable,
];

export interface PurgeBatchResult {
  deleted: number;
  detached: number;
  drained: boolean;
}

/**
 * Soft-detach active workspaces: stamp `removedAt` and drop the chatroom's primary
 * workspace pointer when it pointed at the detached workspace. Rows are never
 * hard-deleted so chatroom history keeps its workspace references.
 */
export async function detachActiveWorkspaces(
  ctx: MutationCtx,
  machineId: string,
  limit: number
): Promise<{ detached: number; drained: boolean }> {
  if (limit <= 0) return { detached: 0, drained: false };

  const rows = await ctx.db
    .query('chatroom_workspaces')
    .withIndex('by_machine_removedAt', (q) =>
      q.eq('machineId', machineId).eq('removedAt', undefined)
    )
    .take(limit);

  const now = Date.now();
  let detached = 0;
  for (const row of rows) {
    await ctx.db.patch('chatroom_workspaces', row._id, { removedAt: now });
    detached++;

    const primary = await ctx.db
      .query('chatroom_primaryWorkspaces')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', row.chatroomId))
      .first();
    if (primary?.workspaceId === row._id) {
      await ctx.db.delete('chatroom_primaryWorkspaces', primary._id);
    }
  }

  return { detached, drained: rows.length < limit };
}

/**
 * Delete one budgeted slice of a machine's data. Callers persist the counters and
 * schedule another batch when `drained` is false.
 */
export async function purgeMachineBatch(
  ctx: MutationCtx,
  key: PurgeKey,
  budget: number = MACHINE_PURGE_BUDGET
): Promise<PurgeBatchResult> {
  let remaining = budget;
  let deleted = 0;

  const detach = await detachActiveWorkspaces(
    ctx,
    key.machineId,
    Math.floor(remaining / WORKSPACE_DETACH_COST)
  );
  remaining -= detach.detached * WORKSPACE_DETACH_COST;
  let drained = detach.drained;

  outer: for (const descriptor of MACHINE_SCOPED_TABLES) {
    const n = Math.floor(remaining / descriptor.cost);
    if (n <= 0) {
      drained = false;
      break;
    }

    const rows = await descriptor.take(ctx, key, n);
    for (const row of rows) {
      if (descriptor.deleteRow) {
        const result = await descriptor.deleteRow(ctx, row);
        remaining -= Math.max(descriptor.cost, result.writes);
        if (result.removed) {
          deleted++;
        } else {
          drained = false;
        }
      } else {
        await ctx.db.delete(descriptor.table, row._id);
        remaining -= descriptor.cost;
        deleted++;
      }

      if (remaining <= 0) {
        drained = false;
        break outer;
      }
    }

    if (rows.length === n) {
      drained = false;
    }
  }

  return { deleted, detached: detach.detached, drained };
}
