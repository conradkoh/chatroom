/**
 * Use Case: Patch Workspace Git State
 *
 * Applies one git-state unit to a workspace's `chatroom_workspaceGitState` row.
 *
 * Writes are change-driven: the row's `updatedAt` only moves when at least one
 * field owned by the unit actually differs from what is stored. This lets the
 * daemon sync on every change without generating write churn for no-op pushes.
 *
 * Constraints:
 * - Only the `head` unit may change `status`. Other units never write it.
 * - The payload never carries `updatedAt`; the server stamps it on a real change.
 * - Fields not owned by the unit are left untouched (patch semantics).
 */

import type { Doc } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { omitUndefined } from '../../../../convex/lib/omitUndefined';
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

type GitStateRow = Doc<'chatroom_workspaceGitState'>;
type GitStateFieldKey = Exclude<
  keyof GitStateRow,
  '_id' | '_creationTime' | 'machineId' | 'workingDir' | 'updatedAt'
>;
/**
 * Row fields a unit may write. `errorMessage` is the only field a unit clears
 * (by setting it to `undefined`), so it alone admits `undefined`.
 */
type GitStateFields = Partial<Pick<GitStateRow, Exclude<GitStateFieldKey, 'errorMessage'>>> & {
  errorMessage?: string | undefined;
};

/**
 * Maps a unit to the row fields it owns.
 *
 * Every unit variant's payload, minus `kind`, is exactly the set of row fields it
 * owns (see workspace-git-state-unit.ts), so the payload is the patch. The one
 * addition: a non-error head clears a previously stored `errorMessage`.
 */
function unitToFields(unit: WorkspaceGitStateUnit): GitStateFields {
  const { kind: _kind, ...fields } = unit;
  return unit.kind === 'head' && unit.status !== 'error'
    ? { ...fields, errorMessage: undefined }
    : fields;
}

/**
 * Serializes a value with object keys sorted, so structurally equal values
 * compare equal regardless of key insertion order.
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
 * Legacy rows may carry only the raw gh `number` field. Normalize them to the
 * canonical `prNumber` shape so they compare equal to incoming units.
 */
function normalizeStoredPullRequests(
  stored: GitStateRow['openPullRequests']
): GitStateFields['openPullRequests'] {
  if (stored === undefined) return undefined;
  return stored.map((pr) => ({
    prNumber: pr.prNumber ?? pr.number ?? 0,
    title: pr.title,
    url: pr.url,
    headRefName: pr.headRefName,
    state: pr.state,
  }));
}

function isFieldEqual(
  key: GitStateFieldKey,
  stored: GitStateRow[GitStateFieldKey],
  next: GitStateFields[GitStateFieldKey]
): boolean {
  const normalizedStored =
    key === 'openPullRequests'
      ? normalizeStoredPullRequests(stored as GitStateRow['openPullRequests'])
      : stored;
  return canonicalJson(normalizedStored) === canonicalJson(next);
}

export async function patchWorkspaceGitState(
  ctx: MutationCtx,
  input: PatchWorkspaceGitStateInput
): Promise<PatchWorkspaceGitStateResult> {
  const { machineId, workingDir, unit, now } = input;

  const workspaces = await ctx.db
    .query('chatroom_workspaces')
    .withIndex('by_machine_workingDir', (q) =>
      q.eq('machineId', machineId).eq('workingDir', workingDir)
    )
    .collect();
  if (!workspaces.some((ws) => isActiveWorkspace(ws.removedAt))) {
    return { applied: false, reason: 'workspace_inactive' };
  }

  const fields = unitToFields(unit);

  const existing = await ctx.db
    .query('chatroom_workspaceGitState')
    .withIndex('by_machine_workingDir', (q) =>
      q.eq('machineId', machineId).eq('workingDir', workingDir)
    )
    .first();

  if (!existing) {
    // Non-head units cannot set `status`; a row created by them defaults to
    // 'available' until the head unit reports the real status.
    await ctx.db.insert(
      'chatroom_workspaceGitState',
      omitUndefined({ machineId, workingDir, status: 'available', ...fields, updatedAt: now })
    );
    return { applied: true };
  }

  const changed = (Object.keys(fields) as GitStateFieldKey[]).some(
    (key) => !isFieldEqual(key, existing[key], fields[key])
  );
  if (!changed) {
    return { applied: false, reason: 'unchanged' };
  }

  await ctx.db.patch('chatroom_workspaceGitState', existing._id, { ...fields, updatedAt: now });
  return { applied: true };
}
