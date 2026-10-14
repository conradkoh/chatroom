import { describe, expect, it } from 'vitest';

import { toWorkspaceGitStateView } from './project-workspace-git-state';
import type { WorkspaceGitUnitRow, WorkspaceGitUnitRows } from './workspace-git-unit-rows';

type HeadRow = WorkspaceGitUnitRow<'head'>;
type WorktreeRow = WorkspaceGitUnitRow<'worktree'>;
type UpstreamRow = WorkspaceGitUnitRow<'upstream'>;
type RemotesRow = WorkspaceGitUnitRow<'remotes'>;
type PullRequestsRow = WorkspaceGitUnitRow<'pullRequests'>;
type ChecksRow = WorkspaceGitUnitRow<'checks'>;

const META = { _creationTime: 1, machineId: 'machine-1', workingDir: '/code/app' } as const;

function headRow(overrides: Partial<HeadRow> = {}): HeadRow {
  return {
    ...META,
    _id: 'head-1',
    updatedAt: 500,
    status: 'available',
    branch: 'feature',
    ...overrides,
  } as unknown as HeadRow;
}

/** A head row with no `branch` (not_found/error, or an available row that has not reported one). */
function headRowWithoutBranch(overrides: Partial<Omit<HeadRow, 'branch'>> = {}): HeadRow {
  return {
    ...META,
    _id: 'head-1',
    updatedAt: 500,
    status: 'available',
    ...overrides,
  } as unknown as HeadRow;
}

function worktreeRow(overrides: Partial<WorktreeRow> = {}): WorktreeRow {
  return {
    ...META,
    _id: 'worktree-1',
    updatedAt: 500,
    isDirty: true,
    diffStat: { filesChanged: 2, insertions: 5, deletions: 1 },
    ...overrides,
  } as unknown as WorktreeRow;
}

function upstreamRow(overrides: Partial<UpstreamRow> = {}): UpstreamRow {
  return {
    ...META,
    _id: 'upstream-1',
    updatedAt: 500,
    commitsAhead: 3,
    commitsBehind: 1,
    ...overrides,
  } as unknown as UpstreamRow;
}

function remotesRow(overrides: Partial<RemotesRow> = {}): RemotesRow {
  return {
    ...META,
    _id: 'remotes-1',
    updatedAt: 500,
    remotes: [{ name: 'origin', url: 'git@example.com:app.git' }],
    ...overrides,
  } as unknown as RemotesRow;
}

function pullRequestsRow(overrides: Partial<PullRequestsRow> = {}): PullRequestsRow {
  return {
    ...META,
    _id: 'pull-requests-1',
    updatedAt: 500,
    openPullRequests: [
      {
        prNumber: 7,
        title: 'Add thing',
        url: 'https://example.test/pulls/7',
        headRefName: 'feature',
        state: 'OPEN',
      },
    ],
    ...overrides,
  } as unknown as PullRequestsRow;
}

function checksRow(overrides: Partial<ChecksRow> = {}): ChecksRow {
  return {
    ...META,
    _id: 'checks-1',
    updatedAt: 500,
    headCommitStatus: null,
    ...overrides,
  } as unknown as ChecksRow;
}

/** A rows fixture with every unit absent; each test sets the rows it needs. */
function rows(partial: Partial<WorkspaceGitUnitRows>): WorkspaceGitUnitRows {
  return {
    head: null,
    worktree: null,
    upstream: null,
    remotes: null,
    pullRequests: null,
    checks: null,
    ...partial,
  };
}

describe('toWorkspaceGitStateView', () => {
  it('is loading when no head row exists', () => {
    expect(toWorkspaceGitStateView(rows({}))).toEqual({ status: 'loading' });
  });

  it('maps an available state with every unit row present', () => {
    const view = toWorkspaceGitStateView(
      rows({
        head: headRow({ updatedAt: 900 }),
        worktree: worktreeRow(),
        upstream: upstreamRow(),
        remotes: remotesRow(),
        pullRequests: pullRequestsRow(),
        checks: checksRow(),
      })
    );

    expect(view).toEqual({
      status: 'available',
      branch: 'feature',
      isDirty: true,
      diffStat: { filesChanged: 2, insertions: 5, deletions: 1 },
      openPullRequests: [
        {
          prNumber: 7,
          title: 'Add thing',
          url: 'https://example.test/pulls/7',
          headRefName: 'feature',
          state: 'OPEN',
        },
      ],
      remotes: [{ name: 'origin', url: 'git@example.com:app.git' }],
      commitsAhead: 3,
      commitsBehind: 1,
      headCommitStatus: null,
      updatedAt: 900,
    });
  });

  it('fills the defaults for available with only the head row', () => {
    expect(toWorkspaceGitStateView(rows({ head: headRow({ updatedAt: 500 }) }))).toEqual({
      status: 'available',
      branch: 'feature',
      isDirty: false,
      diffStat: { filesChanged: 0, insertions: 0, deletions: 0 },
      openPullRequests: [],
      remotes: [],
      commitsAhead: 0,
      commitsBehind: 0,
      headCommitStatus: null,
      updatedAt: 500,
    });
  });

  it('defaults the branch label when the head row has no branch', () => {
    const view = toWorkspaceGitStateView(rows({ head: headRowWithoutBranch() }));

    expect(view.status === 'available' && view.branch).toBe('HEAD');
  });

  it('maps a not_found head to not_found and ignores the other unit rows', () => {
    expect(
      toWorkspaceGitStateView(
        rows({
          head: headRowWithoutBranch({ status: 'not_found', updatedAt: 321 }),
          worktree: worktreeRow({ updatedAt: 999 }),
          upstream: upstreamRow({ updatedAt: 999 }),
        })
      )
    ).toEqual({ status: 'not_found', updatedAt: 321 });
  });

  it('maps an error head to its message and ignores the other unit rows', () => {
    expect(
      toWorkspaceGitStateView(
        rows({
          head: headRowWithoutBranch({ status: 'error', errorMessage: 'git not installed' }),
          worktree: worktreeRow(),
        })
      )
    ).toEqual({ status: 'error', message: 'git not installed', updatedAt: 500 });
  });

  it('uses a generic message for an error head with no message recorded', () => {
    const view = toWorkspaceGitStateView(rows({ head: headRowWithoutBranch({ status: 'error' }) }));

    expect(view).toEqual({ status: 'error', message: 'Unknown error', updatedAt: 500 });
  });

  it('takes updatedAt from the newest present row', () => {
    const view = toWorkspaceGitStateView(
      rows({
        head: headRow({ updatedAt: 100 }),
        worktree: worktreeRow({ updatedAt: 900 }),
        remotes: remotesRow({ updatedAt: 700 }),
      })
    );

    expect(view.status === 'available' && view.updatedAt).toBe(900);
  });
});
