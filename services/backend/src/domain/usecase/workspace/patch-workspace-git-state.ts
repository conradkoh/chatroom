/**
 * Use Case: Patch Workspace Git State
 *
 * Applies one git-state unit to its per-unit row (see `WORKSPACE_GIT_UNIT_TABLE`). Each unit owns its
 * own table, so a patch reads the workspace rows and only its own unit row — never the whole git
 * state.
 *
 * Writes are change-driven: the row's `updatedAt` only moves when a field owned by the unit actually
 * differs from what is stored. This lets the daemon sync on every change without generating write
 * churn for no-op pushes.
 *
 * Constraints:
 * - Only the `head` unit defines `status`. Other units never store it, and this use case never
 *   inserts a default `status`.
 * - The row is written with `replace`, so a field the unit no longer sends (e.g. `branch` when head
 *   becomes `not_found`, `errorMessage` when head becomes `available`) is cleared.
 * - The payload never carries `updatedAt`; the server stamps it on a real change.
 * - Removed workspaces write nothing: their unit rows are purged on removal and a late daemon patch
 *   must not resurrect them.
 */

import { findUnitRow, writeUnitRow } from './workspace-git-unit-rows';
import type { WorkspaceGitUnitKind, WorkspaceGitUnitRow } from './workspace-git-unit-rows';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { isActiveWorkspace } from '../../entities/workspace';
import type { WorkspaceGitStateUnit } from '../../entities/workspace-git-state-unit';

export type PatchWorkspaceGitStateResult =
  { applied: true } | { applied: false; reason: 'unchanged' | 'workspace_inactive' };

export interface PatchWorkspaceGitStateInput {
  machineId: string;
  workingDir: string;
  unit: WorkspaceGitStateUnit;
  now: number;
}

/** Row fields that are identity or timestamps, not part of the unit's payload. */
type UnitRowMeta = '_id' | '_creationTime' | 'machineId' | 'workingDir' | 'updatedAt';

/** The stored unit payload, with row metadata removed for the changed-check. */
function stripRowMeta<T extends Record<UnitRowMeta, unknown>>(row: T): Omit<T, UnitRowMeta> {
  const { _id, _creationTime, machineId, workingDir, updatedAt, ...fields } = row;
  return fields;
}

type UnitFields = Omit<WorkspaceGitStateUnit, 'kind'>;

/** True when the stored unit row already matches the incoming unit payload. */
function isUnchanged(
  existing: WorkspaceGitUnitRow<WorkspaceGitUnitKind> | null,
  fields: UnitFields
): boolean {
  return existing !== null && canonicalJson(stripRowMeta(existing)) === canonicalJson(fields);
}

/**
 * Serializes a value with object keys sorted, so structurally equal values
 * compare equal regardless of key insertion order. `JSON.stringify` drops `undefined`.
 */
function canonicalJson(value: unknown): string | undefined {
  return JSON.stringify(value, (_key, nested: unknown) => {
    if (nested === null || typeof nested !== 'object' || Array.isArray(nested)) return nested;
    return Object.fromEntries(
      Object.entries(nested).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    );
  });
}

/**
 * True when any workspace row for (machineId, workingDir) is active. Stops at the first active row,
 * so it never materializes every workspace row for the directory.
 */
async function hasActiveWorkspace(
  ctx: MutationCtx,
  machineId: string,
  workingDir: string
): Promise<boolean> {
  for await (const ws of ctx.db
    .query('chatroom_workspaces')
    .withIndex('by_machine_workingDir', (q) =>
      q.eq('machineId', machineId).eq('workingDir', workingDir)
    )) {
    if (isActiveWorkspace(ws.removedAt)) return true;
  }
  return false;
}

export async function patchWorkspaceGitState(
  ctx: MutationCtx,
  input: PatchWorkspaceGitStateInput
): Promise<PatchWorkspaceGitStateResult> {
  const { machineId, workingDir, unit, now } = input;

  if (!(await hasActiveWorkspace(ctx, machineId, workingDir))) {
    return { applied: false, reason: 'workspace_inactive' };
  }

  const { kind, ...fields } = unit;
  const existing = await findUnitRow(ctx, kind, { machineId, workingDir });

  if (isUnchanged(existing, fields)) {
    return { applied: false, reason: 'unchanged' };
  }

  await writeUnitRow(ctx, kind, existing === null ? null : existing._id, {
    machineId,
    workingDir,
    ...fields,
    updatedAt: now,
  });
  return { applied: true };
}
