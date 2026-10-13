import { describe, expect, it } from 'vitest';

import { toWorkspaceGitStateView } from './project-workspace-git-state';
import type { Doc } from '../../../../convex/_generated/dataModel';

type GitStateRow = Doc<'chatroom_workspaceGitState'>;

/** A stored row with only the identity and status fields set. Each test adds what it needs. */
function row(overrides: Record<string, unknown> & { status: GitStateRow['status'] }): GitStateRow {
  return {
    _id: 'gitstate-1',
    _creationTime: 1,
    machineId: 'machine-1',
    workingDir: '/code/app',
    updatedAt: 500,
    ...overrides,
  } as unknown as GitStateRow;
}

describe('toWorkspaceGitStateView', () => {
  it('is loading when no row has been pushed yet', () => {
    expect(toWorkspaceGitStateView(null)).toEqual({ status: 'loading' });
  });

  it('maps an available row with every field set', () => {
    const view = toWorkspaceGitStateView(
      row({
        status: 'available',
        branch: 'feature',
        isDirty: true,
        diffStat: { filesChanged: 2, insertions: 5, deletions: 1 },
        openPullRequests: [{ prNumber: 7, title: 'Add thing' }],
        remotes: [{ name: 'origin', url: 'git@example.com:app.git' }],
        commitsAhead: 3,
        commitsBehind: 1,
        defaultBranch: 'main',
        headCommitStatus: null,
        defaultBranchStatus: null,
        updatedAt: 900,
      })
    );

    expect(view).toEqual({
      status: 'available',
      branch: 'feature',
      isDirty: true,
      diffStat: { filesChanged: 2, insertions: 5, deletions: 1 },
      openPullRequests: [{ prNumber: 7, title: 'Add thing' }],
      remotes: [{ name: 'origin', url: 'git@example.com:app.git' }],
      commitsAhead: 3,
      commitsBehind: 1,
      defaultBranch: 'main',
      headCommitStatus: null,
      defaultBranchStatus: null,
      updatedAt: 900,
    });
  });

  it('fills the defaults for an available row with no optional fields', () => {
    expect(toWorkspaceGitStateView(row({ status: 'available' }))).toEqual({
      status: 'available',
      branch: 'HEAD',
      isDirty: false,
      diffStat: { filesChanged: 0, insertions: 0, deletions: 0 },
      openPullRequests: [],
      remotes: [],
      commitsAhead: 0,
      commitsBehind: 0,
      defaultBranch: null,
      headCommitStatus: null,
      defaultBranchStatus: null,
      updatedAt: 500,
    });
  });

  it('uses prNumber when present, falls back to number, and then to 0', () => {
    const view = toWorkspaceGitStateView(
      row({
        status: 'available',
        openPullRequests: [{ prNumber: 4, number: 99 }, { number: 12 }, { title: 'no number' }],
      })
    );

    expect(view.status === 'available' && view.openPullRequests.map((pr) => pr.prNumber)).toEqual([
      4, 12, 0,
    ]);
  });

  it('maps a not_found row to not_found with its timestamp', () => {
    expect(toWorkspaceGitStateView(row({ status: 'not_found', updatedAt: 321 }))).toEqual({
      status: 'not_found',
      updatedAt: 321,
    });
  });

  it('maps an error row to its message and timestamp', () => {
    expect(
      toWorkspaceGitStateView(
        row({ status: 'error', errorMessage: 'git not installed', updatedAt: 42 })
      )
    ).toEqual({ status: 'error', message: 'git not installed', updatedAt: 42 });
  });

  it('uses a generic message for an error row with none recorded', () => {
    expect(toWorkspaceGitStateView(row({ status: 'error', updatedAt: 42 }))).toEqual({
      status: 'error',
      message: 'Unknown error',
      updatedAt: 42,
    });
  });
});
