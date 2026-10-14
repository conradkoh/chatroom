/**
 * Use Case: Workspace Git Unit Rows
 *
 * The single place that maps a git unit kind to its per-unit table for reads
 * and deletes. `WORKSPACE_GIT_UNIT_TABLE` is the mapping source of truth; this
 * module owns every lookup so callers never need a per-kind switch.
 *
 * Each unit table is keyed by (machineId, workingDir) via the
 * `by_machine_workingDir` index:
 * - Workspace-scoped reads and deletes filter both fields.
 * - Machine-wide deletes use only the `machineId` prefix of that index.
 *
 * Constraints:
 * - Convex's typed `db` cannot narrow the table-name union produced by a
 *   generic `kind` (it resolves the query against the first table in the data
 *   model). The union is therefore erased once per function through
 *   `UnitTableStore`; those casts live only in `findUnitRow` and the delete
 *   loop.
 * - `head` is read first and short-circuits: when it is absent or not
 *   'available' the remaining units are not read at all.
 */

import type { Doc, Id, TableNames } from '../../../../convex/_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../../../../convex/_generated/server';
import {
  WORKSPACE_GIT_UNIT_TABLE,
  type WorkspaceGitStateUnit,
} from '../../entities/workspace-git-state-unit';

export type WorkspaceGitUnitKind = WorkspaceGitStateUnit['kind'];

/** The stored row for one unit kind. */
export type WorkspaceGitUnitRow<K extends WorkspaceGitUnitKind> = Doc<
  (typeof WORKSPACE_GIT_UNIT_TABLE)[K]
>;

/** One row per unit kind; `null` when the unit is absent (or skipped). */
export type WorkspaceGitUnitRows = { [K in WorkspaceGitUnitKind]: WorkspaceGitUnitRow<K> | null };

/** Identifies the workspace a unit belongs to. */
export interface WorkspaceTarget {
  machineId: string;
  workingDir: string;
}

/**
 * The subset of Convex's `db` used here, with the table name widened to
 * `TableNames`. Exists solely to erase the table-name union that the typed `db`
 * cannot narrow for a runtime table name; all other typing is preserved.
 */
interface UnitTableStore {
  query(table: TableNames): {
    withIndex(
      index: 'by_machine_workingDir',
      range: (q: {
        eq(field: 'machineId', value: string): { eq(field: 'workingDir', value: string): unknown };
      }) => unknown
    ): {
      first(): Promise<{ _id: Id<TableNames> } | null>;
      collect(): Promise<{ _id: Id<TableNames> }[]>;
    };
  };
  delete(table: TableNames, id: Id<TableNames>): Promise<void>;
}

/**
 * One row by (machineId, workingDir) via `by_machine_workingDir` `.first()`.
 *
 * Exported for the workspace git read path, which lands in the next slice.
 */
// fallow-ignore-next-line unused-export
export async function findUnitRow<K extends WorkspaceGitUnitKind>(
  ctx: QueryCtx | MutationCtx,
  kind: K,
  target: WorkspaceTarget
): Promise<WorkspaceGitUnitRow<K> | null> {
  // Single cast: erase the table-name union so a runtime table name can be
  // queried by its index. See the module header.
  const db = ctx.db as unknown as UnitTableStore;
  const table = WORKSPACE_GIT_UNIT_TABLE[kind];
  const row = await db
    .query(table)
    .withIndex('by_machine_workingDir', (q) =>
      q.eq('machineId', target.machineId).eq('workingDir', target.workingDir)
    )
    .first();
  return row as WorkspaceGitUnitRow<K> | null;
}

/**
 * Reads all six unit rows for a workspace.
 *
 * `head` is read first. If it is missing or its `status` is not 'available',
 * the other five reads are skipped entirely and returned as `null` — a
 * workspace without a usable HEAD has no meaningful other units, and the
 * short-circuit avoids up to five extra index scans.
 *
 * Exported for the workspace git read path, which lands in the next slice.
 */
// fallow-ignore-next-line unused-export
export async function readWorkspaceGitUnitRows(
  ctx: QueryCtx,
  target: WorkspaceTarget
): Promise<WorkspaceGitUnitRows> {
  const head = await findUnitRow(ctx, 'head', target);
  if (!head || head.status !== 'available') {
    return {
      head,
      worktree: null,
      upstream: null,
      remotes: null,
      pullRequests: null,
      checks: null,
    };
  }

  const [worktree, upstream, remotes, pullRequests, checks] = await Promise.all([
    findUnitRow(ctx, 'worktree', target),
    findUnitRow(ctx, 'upstream', target),
    findUnitRow(ctx, 'remotes', target),
    findUnitRow(ctx, 'pullRequests', target),
    findUnitRow(ctx, 'checks', target),
  ]);

  return { head, worktree, upstream, remotes, pullRequests, checks };
}

/**
 * Deletes every unit row for a workspace.
 *
 * With `workingDir` omitted, deletes every unit row for the machine (the
 * `machineId` prefix of `by_machine_workingDir`). A workspace has at most one
 * row per table, and a machine has at most a few workspaces, so the rows are
 * collected before deletion.
 */
export async function deleteWorkspaceGitUnitRows(
  ctx: MutationCtx,
  machineId: string,
  workingDir?: string
): Promise<void> {
  // Single cast: erase the table-name union so the runtime table name can be
  // queried and deleted. See the module header.
  const db = ctx.db as unknown as UnitTableStore;
  for (const table of Object.values(WORKSPACE_GIT_UNIT_TABLE)) {
    const rows = await db
      .query(table)
      .withIndex('by_machine_workingDir', (q) => {
        const byMachine = q.eq('machineId', machineId);
        return workingDir === undefined ? byMachine : byMachine.eq('workingDir', workingDir);
      })
      .collect();

    for (const row of rows) {
      await db.delete(table, row._id);
    }
  }
}
