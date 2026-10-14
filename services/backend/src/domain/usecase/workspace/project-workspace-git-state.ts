/**
 * Use Case: Project Workspace Git State
 *
 * Turns the per-unit git-state rows into the view the webapp reads. Pure: the query does the auth and
 * the read, and this maps what it found. Missing unit rows take the defaults the view has always
 * used.
 *
 * Only `head` decides the status. When no head row exists the view is `loading`; `not_found` and
 * `error` come from head alone and ignore the other units.
 */

import type { WorkspaceGitUnitRow, WorkspaceGitUnitRows } from './workspace-git-unit-rows';
import type { WorkspaceGitState } from '../../types/workspace-git';

type AvailableView = Extract<WorkspaceGitState, { status: 'available' }>;
type ErrorView = Extract<WorkspaceGitState, { status: 'error' }>;
type HeadRow = WorkspaceGitUnitRow<'head'>;

function isPresent<T>(row: T | null): row is T {
  return row !== null;
}

function toErrorView(head: HeadRow): ErrorView {
  return {
    status: 'error',
    message: head.errorMessage ?? 'Unknown error',
    updatedAt: head.updatedAt,
  };
}

function toWorkingTreeFields(
  rows: WorkspaceGitUnitRows,
  head: HeadRow
): Pick<AvailableView, 'branch' | 'isDirty' | 'diffStat'> {
  const worktree = rows.worktree;
  return {
    branch: head.branch ?? 'HEAD',
    isDirty: worktree ? worktree.isDirty : false,
    diffStat: worktree ? worktree.diffStat : { filesChanged: 0, insertions: 0, deletions: 0 },
  };
}

function toHistoryFields(
  rows: WorkspaceGitUnitRows
): Pick<AvailableView, 'remotes' | 'commitsAhead' | 'commitsBehind'> {
  const { upstream, remotes } = rows;
  return {
    remotes: remotes ? remotes.remotes : [],
    commitsAhead: upstream ? upstream.commitsAhead : 0,
    commitsBehind: upstream ? upstream.commitsBehind : 0,
  };
}

function toAvailableView(rows: WorkspaceGitUnitRows, head: HeadRow): AvailableView {
  const { pullRequests, checks } = rows;
  const present = [rows.worktree, rows.upstream, rows.remotes, pullRequests, checks].filter(
    isPresent
  );

  return {
    status: 'available',
    ...toWorkingTreeFields(rows, head),
    openPullRequests: pullRequests ? pullRequests.openPullRequests : [],
    ...toHistoryFields(rows),
    headCommitStatus: checks ? checks.headCommitStatus : null,
    updatedAt: Math.max(head.updatedAt, ...present.map((row) => row.updatedAt)),
  };
}

/**
 * The view for a workspace's git state. `loading` when no head row exists. Head alone decides
 * not_found and error; other units are ignored for those statuses. For `available`, a missing
 * unit row takes the default the view has always used.
 */
export function toWorkspaceGitStateView(rows: WorkspaceGitUnitRows): WorkspaceGitState {
  const { head } = rows;
  if (!head) return { status: 'loading' };
  if (head.status === 'not_found') return { status: 'not_found', updatedAt: head.updatedAt };
  if (head.status === 'error') return toErrorView(head);
  return toAvailableView(rows, head);
}
