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
 * descriptor declares a `cost`: `1` for small rows and `30` for rows that can
 * approach 1 MiB (gzip blobs, shards, diffs, file content, command runs). A batch
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

/**
 * Document-work budget for one purge batch (about 300 units per Convex mutation).
 *
 * Small rows cost 1 unit. Rows that can approach 1 MiB (blobs, shards, diffs, file
 * content, command runs, ledger chunks) cost 30 units, so one batch reads at most 10
 * of them (about 10 MiB). That leaves headroom under Convex's per-mutation read-bytes
 * cap (about 16 MiB, per the Convex limits docs) for small rows and the workspace
 * detach step. The earlier cost of 15 allowed 20 such rows in one mutation.
 */
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
  /** 1 = small row; 30 = row that can approach 1 MiB (blobs, shards, diffs, file content, command runs, ledger chunks). */
  cost: 1 | 30;
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
  cost: 1 | 30 = 1,
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
 * Command runs own two satellite tables. Output chunks are drained in pages of
 * COMMAND_RUN_CHUNK_PAGE per call, so one large run stays under the per-mutation read cap.
 * A full page means more chunks remain: the run row is reported not removed and the next
 * batch resumes. The run row (and its live tail) is only removed once its chunks are gone.
 */
const COMMAND_RUN_CHUNK_PAGE = 50;

const commandRunsTable: MachineScopedTable = {
  table: 'chatroom_commandRunsV2',
  cost: 30,
  take: byMachine('chatroom_commandRunsV2', 'by_machine_workingDir', 30).take,
  deleteRow: async (ctx, row) => {
    const runId = row._id as Id<'chatroom_commandRunsV2'>;
    const chunks = await ctx.db
      .query('chatroom_commandOutputV2')
      .withIndex('by_runId_chunkIndex', (q) => q.eq('runId', runId))
      .take(COMMAND_RUN_CHUNK_PAGE);
    for (const chunk of chunks) {
      await ctx.db.delete('chatroom_commandOutputV2', chunk._id);
    }
    if (chunks.length === COMMAND_RUN_CHUNK_PAGE) return { writes: chunks.length, removed: false };

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

/** A machine backup row may own one `_storage` blob (a ready or downloading copy). Delete the blob, then the row. */
const machineBackupRequestsTable: MachineScopedTable = {
  table: 'chatroom_machineBackupRequests',
  cost: 1,
  take: byMachine('chatroom_machineBackupRequests', 'by_machineId_createdAt').take,
  deleteRow: async (ctx, row) => {
    const id = row._id as Id<'chatroom_machineBackupRequests'>;
    const request = await ctx.db.get('chatroom_machineBackupRequests', id);
    if (request === null) return { writes: 0, removed: true };
    if (request.storageId && (await ctx.db.system.get('_storage', request.storageId))) {
      await ctx.storage.delete(request.storageId);
    }
    await ctx.db.delete('chatroom_machineBackupRequests', id);
    return { writes: 2, removed: true };
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
  byMachine('chatroom_machineProjectRoots', 'by_machineId'),
  byMachine('chatroom_capabilities_refresh_machine_results', 'by_machineId'),
  byMachine('chatroom_repositoryLedgerRequests', 'by_machineId_createdAt'),
  byMachine('chatroom_repositoryLedgerChunks', 'by_machineId', 30),
  machineBackupRequestsTable,

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
  byMachine('chatroom_workspaceFullDiff', 'by_machine_workingDir', 30),
  byMachine('chatroom_workspaceFullDiffV2', 'by_machine_workingDir', 30),
  byMachine('chatroom_workspacePRDiffs', 'by_machine_workingDir', 30),
  byMachine('chatroom_workspaceCommitDetail', 'by_machine_workingDir_sha', 30),
  byMachine('chatroom_workspaceCommitDetailV2', 'by_machine_workingDir_sha', 30),

  // File trees and listings.
  byMachine('chatroom_workspaceFileTree', 'by_machine_workingDir', 30),
  byMachine('chatroom_workspaceFileTreeV2', 'by_machine_workingDir', 30),
  byMachine('chatroom_workspaceFileTreeCheckpointV2', 'by_machine_workingDir', 30),
  byMachine('chatroom_workspaceFileTreeShardV3', 'by_machine_workingDir_syncGeneration', 30),
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
  byMachine('chatroom_workspaceFileContent', 'by_machine_workingDir_path', 30),
  byMachine('chatroom_workspaceFileContentV2', 'by_machine_workingDir_path', 30),
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

/** Soft-detach one workspace and clear its primary pointer when it was primary. */
async function detachWorkspace(
  ctx: MutationCtx,
  workspace: { _id: Id<'chatroom_workspaces'>; chatroomId: Id<'chatroom_rooms'> },
  now: number
): Promise<void> {
  await ctx.db.patch('chatroom_workspaces', workspace._id, { removedAt: now });

  const primary = await ctx.db
    .query('chatroom_primaryWorkspaces')
    .withIndex('by_chatroom', (q) => q.eq('chatroomId', workspace.chatroomId))
    .first();
  if (primary?.workspaceId === workspace._id) {
    await ctx.db.delete('chatroom_primaryWorkspaces', primary._id);
  }
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
  for (const row of rows) {
    await detachWorkspace(ctx, row, now);
  }

  return { detached: rows.length, drained: rows.length < limit };
}

/**
 * Delete one descriptor row, charging its cost (or the custom write count) to the
 * remaining budget. Returns whether the row itself was removed.
 */
async function deleteOneRow(
  ctx: MutationCtx,
  descriptor: MachineScopedTable,
  row: PurgeRowRef
): Promise<{ spent: number; removed: boolean }> {
  if (descriptor.deleteRow) {
    const result = await descriptor.deleteRow(ctx, row);
    return { spent: Math.max(descriptor.cost, result.writes), removed: result.removed };
  }
  await ctx.db.delete(descriptor.table, row._id);
  return { spent: descriptor.cost, removed: true };
}

/**
 * Delete the rows of one descriptor until the budget runs out or the table is
 * drained. Returns the number of rows actually removed and whether this
 * descriptor returned fewer rows than requested.
 */
async function deleteDescriptorRows(
  ctx: MutationCtx,
  descriptor: MachineScopedTable,
  key: PurgeKey,
  limit: number,
  remaining: number
): Promise<{ deleted: number; remaining: number; drained: boolean }> {
  const rows = await descriptor.take(ctx, key, limit);
  let deleted = 0;
  let budget = remaining;
  // A full page, or a custom deleteRow that needs another batch, means more work.
  let moreWork = rows.length === limit;

  for (const row of rows) {
    const outcome = await deleteOneRow(ctx, descriptor, row);
    budget -= outcome.spent;
    if (outcome.removed) deleted++;
    else moreWork = true;

    if (budget <= 0) return { deleted, remaining: budget, drained: false };
  }

  return { deleted, remaining: budget, drained: !moreWork };
}

/** Purge one descriptor if the remaining budget allows at least one row. */
async function purgeDescriptor(
  ctx: MutationCtx,
  key: PurgeKey,
  descriptor: MachineScopedTable,
  remaining: number
): Promise<{ deleted: number; remaining: number; drained: boolean } | null> {
  const limit = Math.floor(remaining / descriptor.cost);
  if (limit <= 0) return null;
  return deleteDescriptorRows(ctx, descriptor, key, limit, remaining);
}

/** Run one registry step and report whether the batch can keep going. */
async function runRegistryStep(
  ctx: MutationCtx,
  key: PurgeKey,
  descriptor: MachineScopedTable,
  remaining: number
): Promise<{ deleted: number; remaining: number; drained: boolean; keepGoing: boolean }> {
  const step = await purgeDescriptor(ctx, key, descriptor, remaining);
  if (step === null) return { deleted: 0, remaining, drained: false, keepGoing: false };
  return { ...step, keepGoing: step.remaining > 0 };
}

/** Walk the registry in order, charging each row to the shared budget. */
async function purgeRegisteredTables(
  ctx: MutationCtx,
  key: PurgeKey,
  startingRemaining: number
): Promise<{ deleted: number; remaining: number; drained: boolean }> {
  let remaining = startingRemaining;
  let deleted = 0;
  let drained = true;

  for (const descriptor of MACHINE_SCOPED_TABLES) {
    const step = await runRegistryStep(ctx, key, descriptor, remaining);
    deleted += step.deleted;
    remaining = step.remaining;
    if (!step.drained) drained = false;
    if (!step.keepGoing) return { deleted, remaining, drained: false };
  }

  return { deleted, remaining, drained };
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
  const detach = await detachActiveWorkspaces(
    ctx,
    key.machineId,
    Math.floor(budget / WORKSPACE_DETACH_COST)
  );
  const remaining = budget - detach.detached * WORKSPACE_DETACH_COST;
  const tables = await purgeRegisteredTables(ctx, key, remaining);

  return {
    deleted: tables.deleted,
    detached: detach.detached,
    drained: detach.drained && tables.drained,
  };
}
