/**
 * git-reader Unit Tests
 *
 * Tests all exported functions using mocked runGit/runGh.
 * No actual git commands are run — all responses are simulated via mocks.
 */

import { describe, expect, test, vi, beforeEach } from 'vitest';

import {
  isGitRepo,
  getBranch,
  isDirty,
  getDiffStat,
  getFullDiff,
  getRecentCommits,
  getCommitDetail,
  getCommitMetadata,
  getOpenPRsForBranch,
  getCommitsAhead,
  getCommitsBehind,
  getCommitStatusChecks,
  getDefaultBranch,
  parseDiffStatLine,
  parseRepoSlug,
  getOriginRepoSlug,
} from './git-reader.js';
import { FULL_DIFF_MAX_BYTES } from './types.js';

type QueuedResponse = { stdout: string; stderr: string } | { error: Error & { code?: number } };

const responseQueue: QueuedResponse[] = [];

function dequeue(): QueuedResponse {
  const next = responseQueue.shift();
  if (!next) throw new Error('No mocked command response queued');
  return next;
}

const mockRunGit =
  vi.fn<
    (args: string[], cwd: string) => Promise<{ stdout: string; stderr: string } | { error: Error }>
  >();

const mockRunGh =
  vi.fn<
    (args: string[], cwd: string) => Promise<{ stdout: string; stderr: string } | { error: Error }>
  >();

vi.mock('./run-command.js', () => ({
  runGit: (args: string[], cwd: string) => mockRunGit(args, cwd),
  runGh: (args: string[], cwd: string) => mockRunGh(args, cwd),
}));

beforeEach(() => {
  vi.clearAllMocks();
  responseQueue.length = 0;
  mockRunGit.mockImplementation(async () => {
    const next = dequeue();
    if ('error' in next) return { error: next.error };
    return { stdout: next.stdout, stderr: next.stderr };
  });
  mockRunGh.mockImplementation(async () => {
    const next = dequeue();
    if ('error' in next) return { error: next.error };
    return { stdout: next.stdout, stderr: next.stderr };
  });
});

function mockSuccess(stdout: string, stderr = ''): void {
  responseQueue.push({ stdout, stderr });
}

function mockFailure(message: string, code = 1): void {
  responseQueue.push({ error: Object.assign(new Error(message), { code }) });
}

// ─── Helper: queue command responses in call order ───────────────────────────

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
  test('parses commit list correctly (no body)', async () => {
    // Record separator: \x1e, field separator: \x1f
    // Format: sha\x1fshortSha\x1fmessage\x1fbody\x1fauthor\x1fdate\x1e
    const output = [
      'abc1234567890abcdef1234567890abcdef123456\x1fabc1234\x1fFix bug\x1f\x1fAlice\x1f2026-01-01T00:00:00Z\x1e',
      'def5678901234567890abcdef5678901234567890\x1fdef5678\x1fAdd feature\x1f\x1fBob\x1f2026-01-02T00:00:00Z\x1e',
    ].join('');
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

  test('parses commit body when present', async () => {
    const output =
      'abc1234567890abcdef1234567890abcdef123456\x1fabc1234\x1fFeat: add body\x1fThis is the body\nwith two lines\x1fAlice\x1f2026-01-01T00:00:00Z\x1e';
    mockSuccess(output);
    const result = await getRecentCommits('/repo');
    expect(result).toHaveLength(1);
    expect(result[0]?.body).toBe('This is the body\nwith two lines');
  });

  test('omits body field when body is empty', async () => {
    const output =
      'abc1234567890abcdef1234567890abcdef123456\x1fabc1234\x1fNo body\x1f\x1fAlice\x1f2026-01-01T00:00:00Z\x1e';
    mockSuccess(output);
    const result = await getRecentCommits('/repo');
    expect(result[0]).not.toHaveProperty('body');
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
    expect(mockRunGit).toHaveBeenCalledWith(expect.arrayContaining(['log', '-20']), '/repo');
  });

  test('passes custom count to git log', async () => {
    mockSuccess('');
    await getRecentCommits('/repo', 5);
    expect(mockRunGit).toHaveBeenCalledWith(expect.arrayContaining(['log', '-5']), '/repo');
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
    mockFailure("fatal: No such remote 'origin'");
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

    expect(mockRunGh).toHaveBeenCalled();
    const ghCall = mockRunGh.mock.calls[0] as [string[], string] | undefined;
    const ghArgs = ghCall?.[0];
    expect(ghArgs).toBeDefined();
    expect(ghArgs).toContain('--repo');
    expect(ghArgs).toContain('myuser/myrepo');
  });

  test('falls back to no --repo when origin slug cannot be resolved', async () => {
    mockFailure("fatal: No such remote 'origin'");
    mockSuccess('[]');

    await getOpenPRsForBranch('/repo', 'feat/x');

    expect(mockRunGh).toHaveBeenCalled();
    const ghCall = mockRunGh.mock.calls[0] as [string[], string] | undefined;
    const ghArgs = ghCall?.[0];
    expect(ghArgs).toBeDefined();
    expect(ghArgs).not.toContain('--repo');
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

// ─── getCommitsBehind ────────────────────────────────────────────────────────

describe('getCommitsBehind', () => {
  test('returns count of commits behind upstream', async () => {
    mockSuccess('4\n');
    const result = await getCommitsBehind('/repo');
    expect(result).toBe(4);
  });

  test('returns 0 when no upstream is configured', async () => {
    mockFailure("fatal: no upstream configured for branch 'main'");
    const result = await getCommitsBehind('/repo');
    expect(result).toBe(0);
  });
});

// ─── getCommitStatusChecks ──────────────────────────────────────────────────

describe('getCommitStatusChecks', () => {
  // Helper to mock the 3-call sequence: git-remote, check-runs, statuses
  function mockCheckRuns(checkRunsPayload: object, statusesPayload: unknown[] = []) {
    mockSuccess('https://github.com/owner/repo.git\n'); // git remote
    mockSuccess(JSON.stringify(checkRunsPayload)); // check-runs
    mockSuccess(JSON.stringify(statusesPayload)); // statuses
  }

  test('PR #463 reproduction: failing legacy Vercel status + successful check-run → failure', async () => {
    // Mirrors the exact scenario that triggered the bug:
    //   - 'Vercel Preview Comments' check-run: success
    //   - 'Vercel' legacy commit status: failure
    mockSuccess('https://github.com/owner/repo.git\n');
    mockSuccess(
      JSON.stringify({
        check_runs: [
          { name: 'Vercel Preview Comments', status: 'completed', conclusion: 'success' },
        ],
        total_count: 1,
      })
    );
    mockSuccess(
      JSON.stringify([
        { context: 'Vercel', state: 'failure', target_url: 'https://vercel.com/deploy/123' },
      ])
    );

    const result = await getCommitStatusChecks('/repo', 'main');
    expect(result).not.toBeNull();
    expect(result!.state).toBe('failure'); // failure wins
    expect(result!.totalCount).toBe(2); // both entries merged
    expect(result!.checkRuns).toHaveLength(2);

    const legacyEntry = result!.checkRuns.find((e) => e.name === 'Vercel');
    expect(legacyEntry).toBeDefined();
    expect(legacyEntry!.conclusion).toBe('failure');

    const modernEntry = result!.checkRuns.find((e) => e.name === 'Vercel Preview Comments');
    expect(modernEntry).toBeDefined();
    expect(modernEntry!.conclusion).toBe('success');
  });

  test('all-success case: both check-runs and statuses successful → success', async () => {
    mockCheckRuns(
      {
        check_runs: [
          { name: 'build', status: 'completed', conclusion: 'success' },
          { name: 'test', status: 'completed', conclusion: 'success' },
        ],
        total_count: 2,
      },
      [{ context: 'deploy', state: 'success', target_url: null }]
    );

    const result = await getCommitStatusChecks('/repo', 'main');
    expect(result).not.toBeNull();
    expect(result!.state).toBe('success');
    expect(result!.totalCount).toBe(3);
    expect(result!.checkRuns.every((e) => e.conclusion === 'success')).toBe(true);
  });

  test('pending legacy status while check-runs complete → pending', async () => {
    mockCheckRuns(
      {
        check_runs: [{ name: 'build', status: 'completed', conclusion: 'success' }],
        total_count: 1,
      },
      [{ context: 'deploy', state: 'pending', target_url: null }]
    );

    const result = await getCommitStatusChecks('/repo', 'main');
    expect(result).not.toBeNull();
    expect(result!.state).toBe('pending'); // legacy pending pulls down state
  });

  test('empty statuses list → check-runs only, no crash', async () => {
    mockCheckRuns(
      {
        check_runs: [{ name: 'build', status: 'completed', conclusion: 'success' }],
        total_count: 1,
      },
      [] // no legacy statuses
    );

    const result = await getCommitStatusChecks('/repo', 'main');
    expect(result).not.toBeNull();
    expect(result!.state).toBe('success');
    expect(result!.totalCount).toBe(1);
    expect(result!.checkRuns[0]!.name).toBe('build');
  });

  test('no check-runs, only legacy statuses', async () => {
    mockCheckRuns({ check_runs: [], total_count: 0 }, [
      { context: 'CI', state: 'success', target_url: 'https://ci.example.com' },
    ]);

    const result = await getCommitStatusChecks('/repo', 'main');
    expect(result).not.toBeNull();
    expect(result!.state).toBe('success');
    expect(result!.totalCount).toBe(1);
    expect(result!.checkRuns[0]!.name).toBe('CI');
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

// ─── getCommitMetadata ────────────────────────────────────────────────────────

describe('getCommitMetadata', () => {
  test('parses commit metadata without body', async () => {
    // Format: message\x1fbody\x1fauthor\x1fdate
    mockSuccess('Fix bug\x1f\x1fAlice\x1f2026-01-01T00:00:00Z');
    const result = await getCommitMetadata('/repo', 'abc1234');
    expect(result).toEqual({
      message: 'Fix bug',
      author: 'Alice',
      date: '2026-01-01T00:00:00Z',
    });
    expect(result).not.toHaveProperty('body');
  });

  test('parses commit body when present', async () => {
    mockSuccess(
      'Feat: big change\x1fThis explains things\nover two lines\x1fBob\x1f2026-01-02T00:00:00Z'
    );
    const result = await getCommitMetadata('/repo', 'def5678');
    expect(result?.body).toBe('This explains things\nover two lines');
  });

  test('trims body whitespace', async () => {
    mockSuccess('Fix\x1f  \n  \x1fAlice\x1f2026-01-01T00:00:00Z');
    const result = await getCommitMetadata('/repo', 'abc1234');
    expect(result).not.toHaveProperty('body');
  });

  test('handles body with special characters (parentheses, quotes, backticks)', async () => {
    const body = 'See PR (#482) for context.\nAlso: "quoted", `backtick`';
    mockSuccess(`Subject\x1f${body}\x1fAlice\x1f2026-01-01T00:00:00Z`);
    const result = await getCommitMetadata('/repo', 'abc1234');
    expect(result?.body).toBe(body);
  });

  test('returns null on git error', async () => {
    mockFailure('fatal: not a git repository');
    const result = await getCommitMetadata('/repo', 'abc1234');
    expect(result).toBeNull();
  });

  test('returns null on empty output', async () => {
    mockSuccess('');
    const result = await getCommitMetadata('/repo', 'abc1234');
    expect(result).toBeNull();
  });
});
