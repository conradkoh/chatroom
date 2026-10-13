/**
 * Use Case: Project Workspace Git State
 *
 * Turns a stored git-state row into the view the webapp reads. Pure: the query does the auth and the
 * read, and this maps what it found. Missing optional fields take the defaults the view has always
 * used.
 */

import type { Doc } from '../../../../convex/_generated/dataModel';
import type { GitPullRequest, WorkspaceGitState } from '../../types/workspace-git';

type GitStateRow = Doc<'chatroom_workspaceGitState'>;
type AvailableView = Extract<WorkspaceGitState, { status: 'available' }>;
type ErrorView = Extract<WorkspaceGitState, { status: 'error' }>;

/** Older rows store the number in `number` only. Missing both reads as 0. */
function toPullRequestView(
  pr: NonNullable<GitStateRow['openPullRequests']>[number]
): GitPullRequest {
  return { ...pr, prNumber: pr.prNumber ?? pr.number ?? 0 };
}

function toOpenPullRequests(prs: GitStateRow['openPullRequests']): GitPullRequest[] {
  return (prs ?? []).map(toPullRequestView);
}

function toWorkingTreeFields(
  row: GitStateRow
): Pick<AvailableView, 'branch' | 'isDirty' | 'diffStat'> {
  return {
    branch: row.branch ?? 'HEAD',
    isDirty: row.isDirty ?? false,
    diffStat: row.diffStat ?? { filesChanged: 0, insertions: 0, deletions: 0 },
  };
}

function toHistoryFields(
  row: GitStateRow
): Pick<AvailableView, 'remotes' | 'commitsAhead' | 'commitsBehind'> {
  return {
    remotes: row.remotes ?? [],
    commitsAhead: row.commitsAhead ?? 0,
    commitsBehind: row.commitsBehind ?? 0,
  };
}

function toBranchStatusFields(
  row: GitStateRow
): Pick<AvailableView, 'defaultBranch' | 'headCommitStatus' | 'defaultBranchStatus'> {
  return {
    defaultBranch: row.defaultBranch ?? null,
    headCommitStatus: row.headCommitStatus ?? null,
    defaultBranchStatus: row.defaultBranchStatus ?? null,
  };
}

function toAvailableView(row: GitStateRow): AvailableView {
  return {
    status: 'available',
    ...toWorkingTreeFields(row),
    openPullRequests: toOpenPullRequests(row.openPullRequests),
    ...toHistoryFields(row),
    ...toBranchStatusFields(row),
    updatedAt: row.updatedAt,
  };
}

function toErrorView(row: GitStateRow): ErrorView {
  return {
    status: 'error',
    message: row.errorMessage ?? 'Unknown error',
    updatedAt: row.updatedAt,
  };
}

/**
 * The view for a workspace's git state. `null` means the daemon has not pushed a row yet, so the
 * state is loading.
 */
export function toWorkspaceGitStateView(row: GitStateRow | null): WorkspaceGitState {
  if (!row) return { status: 'loading' };
  if (row.status === 'available') return toAvailableView(row);
  if (row.status === 'not_found') return { status: 'not_found', updatedAt: row.updatedAt };
  return toErrorView(row);
}
