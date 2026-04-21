/**
 * git-reader Unit Tests
 *
 * Tests all exported functions using mocked child_process.exec.
 * No actual git commands are run — all responses are simulated via mocks.
 */

import { exec } from 'node:child_process';

import { describe, expect, test, vi, beforeEach } from 'vitest';

import {
  isGitRepo,
  getBranch,
  isDirty,
  getDiffStat,
  getFullDiff,
  getRecentCommits,
  getCommitDetail,
  getOpenPRsForBranch,
  getCommitsAhead,
  getCommitStatusChecks,
  getDefaultBranch,
  parseDiffStatLine,
  parseRepoSlug,
  getOriginRepoSlug,
} from './git-reader.js';
import { FULL_DIFF_MAX_BYTES } from './types.js';

// Mock the node built-ins before importing the module under test
vi.mock('node:child_process', () => ({
  exec: vi.fn(),
}));

vi.mock('node:util', () => ({
  promisify: (fn: Function) => fn,
}));

const mockExec = vi.mocked(exec);

// ─── Helper: mock exec to return success ────────────────────────────────────

function mockSuccess(stdout: string, stderr = ''): void {
  // exec is promisified — mock returns a promise that resolves
  mockExec.mockImplementationOnce((_cmd, _opts, callback) => {
    // promisify wraps the node-style callback; return the raw value
    return Promise.resolve({ stdout, stderr }) as unknown as ReturnType<typeof exec>;
  });
}

function mockFailure(message: string, code = 1): void {
  const err = Object.assign(new Error(message), { code });
  mockExec.mockImplementationOnce(() => {
    return Promise.reject(err) as unknown as ReturnType<typeof exec>;
  });
}

// ─── Restore mocks between tests ────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── parseDiffStatLine ───────────────────────────────────────────────────────

describe('parseDiffStatLine', () => {
  test('parses standard stat line with all fields', () => {
    const result = parseDiffStatLine('3 files changed, 45 insertions(+), 12 deletions(-)');
    expect(result).toEqual({ filesChanged: 3, insertions: 45, deletions: 12 });
  });

  test('parses stat line with only insertions', () => {
    const result = parseDiffStatLine('1 file changed, 10 insertions(+)');
    expect(result).toEqual({ filesChanged: 1, insertions: 10, deletions: 0 });
  });

  test('parses stat line with only deletions', () => {
    const result = parseDiffStatLine('2 files changed, 5 deletions(-)');
    expect(result).toEqual({ filesChanged: 2, insertions: 0, deletions: 5 });
  });

  test('returns zeros for empty string', () => {
    const result = parseDiffStatLine('');
    expect(result).toEqual({ filesChanged: 0, insertions: 0, deletions: 0 });
  });

  test('parses large numbers', () => {
    const result = parseDiffStatLine('100 files changed, 10000 insertions(+), 3000 deletions(-)');
    expect(result).toEqual({ filesChanged: 100, insertions: 10000, deletions: 3000 });
  });
});

// ─── isGitRepo ───────────────────────────────────────────────────────────────

describe('isGitRepo', () => {
  test('returns true when git rev-parse returns a .git path', async () => {
    mockSuccess('.git\n');
    expect(await isGitRepo('/some/repo')).toBe(true);
  });

  test('returns false for non-git directory (not a git repository error)', async () => {
    mockFailure('fatal: not a git repository (or any of the parent directories): .git');
    expect(await isGitRepo('/not/a/repo')).toBe(false);
  });

  test('returns false when git is not installed', async () => {
    mockFailure('command not found: git');
    expect(await isGitRepo('/some/dir')).toBe(false);
  });

  test('returns false on any other error', async () => {
    mockFailure('Permission denied');
    expect(await isGitRepo('/restricted')).toBe(false);
  });
});

// ─── getBranch ───────────────────────────────────────────────────────────────

describe('getBranch', () => {
  test('returns available with branch name for normal branch', async () => {
    mockSuccess('main\n');
    const result = await getBranch('/repo');
    expect(result).toEqual({ status: 'available', branch: 'main' });
  });

  test('returns available with feature branch name', async () => {
    mockSuccess('feat/my-feature\n');
    const result = await getBranch('/repo');
    expect(result).toEqual({ status: 'available', branch: 'feat/my-feature' });
  });

  test('returns available with HEAD for detached HEAD state', async () => {
    mockSuccess('HEAD\n');
    const result = await getBranch('/repo');
    expect(result).toEqual({ status: 'available', branch: 'HEAD' });
  });

  test('returns available with HEAD for empty repo (unknown revision)', async () => {
    mockFailure(
      "fatal: ambiguous argument 'HEAD': unknown revision or path not in the working tree"
    );
    const result = await getBranch('/repo');
    expect(result).toEqual({ status: 'available', branch: 'HEAD' });
  });

  test('returns not_found for non-git directory', async () => {
    mockFailure('fatal: not a git repository (or any of the parent directories): .git');
    const result = await getBranch('/not/a/repo');
    expect(result).toEqual({ status: 'not_found' });
  });

  test('returns error for git not installed', async () => {
    mockFailure('command not found: git');
    const result = await getBranch('/repo');
    expect(result).toEqual({ status: 'error', message: 'git is not installed or not in PATH' });
  });
});

// ─── isDirty ─────────────────────────────────────────────────────────────────

describe('isDirty', () => {
  test('returns true when git status --porcelain has output (dirty)', async () => {
    mockSuccess(' M src/index.ts\n');
    expect(await isDirty('/repo')).toBe(true);
  });

  test('returns false when git status --porcelain is empty (clean)', async () => {
    mockSuccess('');
    expect(await isDirty('/repo')).toBe(false);
  });

  test('returns false for non-git directory (no throw)', async () => {
    mockFailure('fatal: not a git repository');
    expect(await isDirty('/not/a/repo')).toBe(false);
  });

  test('returns false on any error (safe default)', async () => {
    mockFailure('Permission denied');
    expect(await isDirty('/restricted')).toBe(false);
  });
});

// ─── getDiffStat ─────────────────────────────────────────────────────────────

describe('getDiffStat', () => {
  test('returns available with zero stats for clean tree', async () => {
    mockSuccess('');
    const result = await getDiffStat('/repo');
    expect(result).toEqual({
      status: 'available',
      diffStat: { filesChanged: 0, insertions: 0, deletions: 0 },
    });
  });

  test('returns available with parsed stats for dirty tree', async () => {
    const statOutput = [
      ' src/foo.ts | 10 +++++++---',
      ' src/bar.ts |  5 -----',
      ' 2 files changed, 7 insertions(+), 8 deletions(-)',
    ].join('\n');
    mockSuccess(statOutput);
    const result = await getDiffStat('/repo');
    expect(result).toEqual({
      status: 'available',
      diffStat: { filesChanged: 2, insertions: 7, deletions: 8 },
    });
  });

  test('returns no_commits for empty repository', async () => {
    mockFailure("fatal: ambiguous argument 'HEAD': unknown revision");
    const result = await getDiffStat('/empty-repo');
    expect(result).toEqual({ status: 'no_commits' });
  });

  test('returns not_found for non-git directory', async () => {
    mockFailure('fatal: not a git repository');
    const result = await getDiffStat('/not/a/repo');
    expect(result).toEqual({ status: 'not_found' });
  });

  test('returns error for permission denied', async () => {
    mockFailure('Permission denied');
    const result = await getDiffStat('/restricted');
    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.message).toContain('Permission denied');
    }
  });
});

// ─── getFullDiff ─────────────────────────────────────────────────────────────

describe('getFullDiff', () => {
  test('returns available with empty content for clean tree', async () => {
    mockSuccess('');
    const result = await getFullDiff('/repo');
    expect(result).toEqual({ status: 'available', content: '', truncated: false });
  });

  test('returns available with diff content', async () => {
    const diff = 'diff --git a/foo.ts b/foo.ts\n+added line\n';
    mockSuccess(diff);
    const result = await getFullDiff('/repo');
    expect(result).toEqual({ status: 'available', content: diff, truncated: false });
  });

  test('returns truncated when diff exceeds max bytes', async () => {
    // Create a string exceeding FULL_DIFF_MAX_BYTES
    const largeDiff = 'x'.repeat(FULL_DIFF_MAX_BYTES + 1000);
    mockSuccess(largeDiff);
    const result = await getFullDiff('/repo');
    expect(result.status).toBe('truncated');
    if (result.status === 'truncated') {
      expect(result.truncated).toBe(true);
      expect(Buffer.byteLength(result.content, 'utf8')).toBeLessThanOrEqual(FULL_DIFF_MAX_BYTES);
    }
  });

  test('returns no_commits for empty repository', async () => {
    mockFailure("fatal: ambiguous argument 'HEAD': unknown revision");
    const result = await getFullDiff('/empty-repo');
    expect(result).toEqual({ status: 'no_commits' });
  });

  test('returns not_found for non-git directory', async () => {
    mockFailure('fatal: not a git repository');
    const result = await getFullDiff('/not/a/repo');
    expect(result).toEqual({ status: 'not_found' });
  });
});

// ─── getRecentCommits ────────────────────────────────────────────────────────

describe('getRecentCommits', () => {
  test('parses commit list correctly', async () => {
    // Null-byte separated: sha, shortSha, message, author, date
    const output = [
      'abc1234567890abcdef1234567890abcdef123456\x00abc1234\x00Fix bug\x00Alice\x002026-01-01T00:00:00Z',
      'def5678901234567890abcdef5678901234567890\x00def5678\x00Add feature\x00Bob\x002026-01-02T00:00:00Z',
    ].join('\n');
    mockSuccess(output);
    const result = await getRecentCommits('/repo');
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      sha: 'abc1234567890abcdef1234567890abcdef123456',
      shortSha: 'abc1234',
      message: 'Fix bug',
      author: 'Alice',
      date: '2026-01-01T00:00:00Z',
    });
    expect(result[1]).toEqual({
      sha: 'def5678901234567890abcdef5678901234567890',
      shortSha: 'def5678',
      message: 'Add feature',
      author: 'Bob',
      date: '2026-01-02T00:00:00Z',
    });
  });

  test('returns empty array for empty repository', async () => {
    mockFailure('fatal: your current branch has no commits yet');
    expect(await getRecentCommits('/empty-repo')).toEqual([]);
  });

  test('returns empty array for non-git directory', async () => {
    mockFailure('fatal: not a git repository');
    expect(await getRecentCommits('/not/a/repo')).toEqual([]);
  });

  test('returns empty array when git output is empty', async () => {
    mockSuccess('');
    expect(await getRecentCommits('/repo')).toEqual([]);
  });

  test('defaults to 20 commits', async () => {
    mockSuccess('');
    await getRecentCommits('/repo');
    expect(mockExec).toHaveBeenCalledWith(expect.stringContaining('log -20'), expect.any(Object));
  });

  test('passes custom count to git log', async () => {
    mockSuccess('');
    await getRecentCommits('/repo', 5);
    expect(mockExec).toHaveBeenCalledWith(expect.stringContaining('log -5'), expect.any(Object));
  });
});

// ─── getCommitDetail ─────────────────────────────────────────────────────────

describe('getCommitDetail', () => {
  test('returns available with commit diff content', async () => {
    const content = 'diff --git a/file.ts b/file.ts\n+added\n';
    mockSuccess(content);
    const result = await getCommitDetail('/repo', 'abc1234');
    expect(result).toEqual({ status: 'available', content, truncated: false });
  });

  test('returns truncated when commit diff exceeds max bytes', async () => {
    const large = 'x'.repeat(FULL_DIFF_MAX_BYTES + 1000);
    mockSuccess(large);
    const result = await getCommitDetail('/repo', 'abc1234');
    expect(result.status).toBe('truncated');
  });

  test('returns not_found for unknown SHA', async () => {
    mockFailure('fatal: bad object deadbeef');
    const result = await getCommitDetail('/repo', 'deadbeef');
    expect(result).toEqual({ status: 'not_found' });
  });

  test('returns not_found for empty repository (unknown revision)', async () => {
    mockFailure("fatal: ambiguous argument 'HEAD': unknown revision");
    const result = await getCommitDetail('/empty-repo', 'HEAD');
    expect(result).toEqual({ status: 'not_found' });
  });

  test('returns not_found for empty repository (no commits yet)', async () => {
    mockFailure('fatal: your current branch has no commits yet');
    const result = await getCommitDetail('/empty-repo', 'abc1234');
    expect(result).toEqual({ status: 'not_found' });
  });

  test('returns not_found for non-git directory', async () => {
    mockFailure('fatal: not a git repository');
    const result = await getCommitDetail('/not/a/repo', 'abc1234');
    expect(result).toEqual({ status: 'not_found' });
  });

  test('returns error for permission denied', async () => {
    mockFailure('Permission denied');
    const result = await getCommitDetail('/restricted', 'abc1234');
    expect(result.status).toBe('error');
  });
});

// ─── parseRepoSlug ───────────────────────────────────────────────────────────

describe('parseRepoSlug', () => {
  test('parses HTTPS URL with .git suffix', () => {
    expect(parseRepoSlug('https://github.com/owner/repo.git')).toBe('owner/repo');
  });

  test('parses HTTPS URL without .git suffix', () => {
    expect(parseRepoSlug('https://github.com/owner/repo')).toBe('owner/repo');
  });

  test('parses SSH URL with .git suffix', () => {
    expect(parseRepoSlug('git@github.com:owner/repo.git')).toBe('owner/repo');
  });

  test('parses SSH URL without .git suffix', () => {
    expect(parseRepoSlug('git@github.com:owner/repo')).toBe('owner/repo');
  });

  test('handles trailing whitespace', () => {
    expect(parseRepoSlug('https://github.com/owner/repo.git\n')).toBe('owner/repo');
  });

  test('returns null for invalid URL', () => {
    expect(parseRepoSlug('not-a-url')).toBeNull();
  });

  test('returns null for empty string', () => {
    expect(parseRepoSlug('')).toBeNull();
  });

  test('parses URL with hyphens in owner and repo', () => {
    expect(parseRepoSlug('https://github.com/my-org/my-repo.git')).toBe('my-org/my-repo');
  });
});

// ─── getOriginRepoSlug ──────────────────────────────────────────────────────

describe('getOriginRepoSlug', () => {
  test('returns slug for HTTPS remote', async () => {
    mockSuccess('https://github.com/owner/repo.git\n');
    const result = await getOriginRepoSlug('/repo');
    expect(result).toBe('owner/repo');
  });

  test('returns slug for SSH remote', async () => {
    mockSuccess('git@github.com:owner/repo.git\n');
    const result = await getOriginRepoSlug('/repo');
    expect(result).toBe('owner/repo');
  });

  test('returns null when origin remote does not exist', async () => {
    mockFailure('fatal: No such remote \'origin\'');
    const result = await getOriginRepoSlug('/repo');
    expect(result).toBeNull();
  });

  test('returns null when git command fails', async () => {
    mockFailure('fatal: not a git repository');
    const result = await getOriginRepoSlug('/not/a/repo');
    expect(result).toBeNull();
  });

  test('returns null for empty output', async () => {
    mockSuccess('');
    const result = await getOriginRepoSlug('/repo');
    expect(result).toBeNull();
  });
});

// ─── getOpenPRsForBranch ─────────────────────────────────────────────────────

describe('getOpenPRsForBranch', () => {
  test('parses valid PR JSON output', async () => {
    // First call: git remote get-url origin
    mockSuccess('https://github.com/user/repo.git\n');
    // Second call: gh pr list
    const prJson = JSON.stringify([
      {
        number: 42,
        title: 'Add feature X',
        url: 'https://github.com/user/repo/pull/42',
        headRefName: 'feat/feature-x',
        state: 'OPEN',
      },
    ]);
    mockSuccess(prJson);
    const result = await getOpenPRsForBranch('/repo', 'feat/feature-x');
    expect(result).toEqual([
      {
        prNumber: 42,
        title: 'Add feature X',
        url: 'https://github.com/user/repo/pull/42',
        headRefName: 'feat/feature-x',
        state: 'OPEN',
      },
    ]);
  });

  test('includes --repo flag when origin slug is available', async () => {
    // First call: git remote get-url origin
    mockSuccess('https://github.com/myuser/myrepo.git\n');
    // Second call: gh pr list
    mockSuccess('[]');

    await getOpenPRsForBranch('/repo', 'feat/x');

    // Second call should include --repo
    expect(mockExec).toHaveBeenCalledTimes(2);
    const ghCall = mockExec.mock.calls[1]![0] as string;
    expect(ghCall).toContain('--repo');
    expect(ghCall).toContain('myuser/myrepo');
  });

  test('falls back to no --repo when origin slug cannot be resolved', async () => {
    // First call: git remote get-url origin fails
    mockFailure('fatal: No such remote \'origin\'');
    // Second call: gh pr list
    mockSuccess('[]');

    await getOpenPRsForBranch('/repo', 'feat/x');

    // Second call should NOT include --repo
    expect(mockExec).toHaveBeenCalledTimes(2);
    const ghCall = mockExec.mock.calls[1]![0] as string;
    expect(ghCall).not.toContain('--repo');
  });

  test('returns empty array for empty JSON array output', async () => {
    mockSuccess('https://github.com/user/repo.git\n');
    mockSuccess('[]');
    const result = await getOpenPRsForBranch('/repo', 'main');
    expect(result).toEqual([]);
  });

  test('returns empty array when gh is not installed', async () => {
    mockSuccess('https://github.com/user/repo.git\n');
    mockFailure('command not found: gh');
    const result = await getOpenPRsForBranch('/repo', 'main');
    expect(result).toEqual([]);
  });

  test('returns empty array when gh auth fails', async () => {
    mockSuccess('https://github.com/user/repo.git\n');
    mockFailure('gh: not logged in');
    const result = await getOpenPRsForBranch('/repo', 'main');
    expect(result).toEqual([]);
  });

  test('returns empty array for non-JSON output', async () => {
    mockSuccess('https://github.com/user/repo.git\n');
    mockSuccess('not valid json');
    const result = await getOpenPRsForBranch('/repo', 'main');
    expect(result).toEqual([]);
  });

  test('returns empty array for empty output', async () => {
    mockSuccess('https://github.com/user/repo.git\n');
    mockSuccess('');
    const result = await getOpenPRsForBranch('/repo', 'main');
    expect(result).toEqual([]);
  });

  test('filters out invalid PR objects', async () => {
    mockSuccess('https://github.com/user/repo.git\n');
    const prJson = JSON.stringify([
      {
        number: 42,
        title: 'Valid PR',
        url: 'https://github.com/user/repo/pull/42',
        headRefName: 'feat/x',
        state: 'OPEN',
      },
      { number: 'not-a-number', title: 'Invalid PR' }, // invalid
      null, // invalid
    ]);
    mockSuccess(prJson);
    const result = await getOpenPRsForBranch('/repo', 'feat/x');
    expect(result).toHaveLength(1);
    expect(result[0]!.prNumber).toBe(42);
  });

  test('parses multiple PRs', async () => {
    mockSuccess('https://github.com/user/repo.git\n');
    const prJson = JSON.stringify([
      {
        number: 1,
        title: 'PR 1',
        url: 'https://github.com/user/repo/pull/1',
        headRefName: 'feat/a',
        state: 'OPEN',
      },
      {
        number: 2,
        title: 'PR 2',
        url: 'https://github.com/user/repo/pull/2',
        headRefName: 'feat/a',
        state: 'OPEN',
      },
    ]);
    mockSuccess(prJson);
    const result = await getOpenPRsForBranch('/repo', 'feat/a');
    expect(result).toHaveLength(2);
    expect(result[0]!.prNumber).toBe(1);
    expect(result[1]!.prNumber).toBe(2);
  });

  test('returns empty array when output is not an array', async () => {
    mockSuccess('https://github.com/user/repo.git\n');
    mockSuccess('{"number": 42}');
    const result = await getOpenPRsForBranch('/repo', 'main');
    expect(result).toEqual([]);
  });
});

// ─── getCommitsAhead ─────────────────────────────────────────────────────────

describe('getCommitsAhead', () => {
  test('returns count of commits ahead of upstream', async () => {
    mockSuccess('3\n');
    const result = await getCommitsAhead('/repo');
    expect(result).toBe(3);
  });

  test('returns 0 when no commits ahead', async () => {
    mockSuccess('0\n');
    const result = await getCommitsAhead('/repo');
    expect(result).toBe(0);
  });

  test('returns 0 when no upstream is configured', async () => {
    mockFailure("fatal: no upstream configured for branch 'main'");
    const result = await getCommitsAhead('/repo');
    expect(result).toBe(0);
  });

  test('returns 0 on any git error', async () => {
    mockFailure('fatal: not a git repository');
    const result = await getCommitsAhead('/repo');
    expect(result).toBe(0);
  });

  test('returns 0 for non-numeric output', async () => {
    mockSuccess('not-a-number\n');
    const result = await getCommitsAhead('/repo');
    expect(result).toBe(0);
  });
});

// ─── getCommitStatusChecks ──────────────────────────────────────────────────

describe('getCommitStatusChecks', () => {
  test('returns status checks when gh api succeeds', async () => {
    // First call: getOriginRepoSlug -> git remote get-url origin
    mockSuccess('https://github.com/owner/repo.git\n');
    // Second call: gh api check-runs
    mockSuccess(JSON.stringify({
      check_runs: [
        { name: 'build', status: 'completed', conclusion: 'success' },
        { name: 'test', status: 'completed', conclusion: 'success' },
      ],
      total_count: 2,
    }));
    // Third call: gh api status
    mockSuccess('success\n');

    const result = await getCommitStatusChecks('/repo', 'main');
    expect(result).not.toBeNull();
    expect(result!.state).toBe('success');
    expect(result!.checkRuns).toHaveLength(2);
    expect(result!.totalCount).toBe(2);
  });

  test('returns failure state when a check run fails', async () => {
    mockSuccess('https://github.com/owner/repo.git\n');
    mockSuccess(JSON.stringify({
      check_runs: [
        { name: 'build', status: 'completed', conclusion: 'failure' },
        { name: 'test', status: 'completed', conclusion: 'success' },
      ],
      total_count: 2,
    }));
    mockSuccess('failure\n');

    const result = await getCommitStatusChecks('/repo', 'main');
    expect(result).not.toBeNull();
    expect(result!.state).toBe('failure');
  });

  test('returns pending state when checks are in progress', async () => {
    mockSuccess('https://github.com/owner/repo.git\n');
    mockSuccess(JSON.stringify({
      check_runs: [
        { name: 'build', status: 'in_progress', conclusion: null },
      ],
      total_count: 1,
    }));
    mockSuccess('pending\n');

    const result = await getCommitStatusChecks('/repo', 'main');
    expect(result).not.toBeNull();
    expect(result!.state).toBe('pending');
  });

  test('returns null when repo slug cannot be determined', async () => {
    mockFailure('fatal: not a git repository');
    const result = await getCommitStatusChecks('/repo', 'main');
    expect(result).toBeNull();
  });

  test('returns null when gh api fails', async () => {
    mockSuccess('https://github.com/owner/repo.git\n');
    mockFailure('gh: not found');
    mockFailure('gh: not found');

    const result = await getCommitStatusChecks('/repo', 'main');
    expect(result).toBeNull();
  });
});

// ─── getDefaultBranch ───────────────────────────────────────────────────────

describe('getDefaultBranch', () => {
  test('returns default branch name', async () => {
    // First call: getOriginRepoSlug -> git remote get-url origin
    mockSuccess('https://github.com/owner/repo.git\n');
    // Second call: gh api repos/owner/repo -> default_branch
    mockSuccess('main\n');

    const result = await getDefaultBranch('/repo');
    expect(result).toBe('main');
  });

  test('returns null when repo slug cannot be determined', async () => {
    mockFailure('fatal: not a git repository');
    const result = await getDefaultBranch('/repo');
    expect(result).toBeNull();
  });

  test('returns null when gh api fails', async () => {
    mockSuccess('https://github.com/owner/repo.git\n');
    mockFailure('gh: not found');

    const result = await getDefaultBranch('/repo');
    expect(result).toBeNull();
  });

  test('returns null for empty response', async () => {
    mockSuccess('https://github.com/owner/repo.git\n');
    mockSuccess('\n');

    const result = await getDefaultBranch('/repo');
    expect(result).toBeNull();
  });
});
