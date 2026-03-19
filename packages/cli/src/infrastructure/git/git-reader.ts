/**
 * Git command execution wrappers.
 *
 * All functions return discriminated unions — no throws.
 * Errors from git (non-zero exit) or missing git installation are
 * captured and returned as `{ status: 'error' }` or `{ status: 'not_found' }`.
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';

import type {
  GitBranchResult,
  GitCommit,
  GitCommitDetailResult,
  GitDiffStat,
  GitDiffStatResult,
  GitFullDiffResult,
} from './types.js';
import { FULL_DIFF_MAX_BYTES } from './types.js';

const execAsync = promisify(exec);

// ─── Internal Helpers ────────────────────────────────────────────────────────

/**
 * Run a git command in `cwd`.
 * Returns `{ stdout, stderr }` on success, `{ error }` on failure.
 * Never throws.
 */
async function runGit(
  args: string,
  cwd: string
): Promise<{ stdout: string; stderr: string } | { error: Error & { code?: number } }> {
  try {
    const result = await execAsync(`git ${args}`, {
      cwd,
      // Disable paging and colour for scriptable output
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_PAGER: 'cat', NO_COLOR: '1' },
      // Increase buffer for large diffs; we'll cap in the caller
      maxBuffer: FULL_DIFF_MAX_BYTES + 64 * 1024,
    });
    return result;
  } catch (err) {
    return { error: err as Error & { code?: number } };
  }
}

/** Returns true if the error message indicates git is not installed. */
function isGitNotInstalled(message: string): boolean {
  return (
    message.includes('command not found') ||
    message.includes('ENOENT') ||
    message.includes('not found') ||
    message.includes("'git' is not recognized")
  );
}

/** Returns true if the error message indicates this is not a git repository. */
function isNotAGitRepo(message: string): boolean {
  return message.includes('not a git repository') || message.includes('Not a git repository');
}

/** Returns true if the error message indicates permission was denied. */
function isPermissionDenied(message: string): boolean {
  return message.includes('Permission denied') || message.includes('EACCES');
}

/** Returns true if the error indicates no commits exist yet (empty repo). */
function isEmptyRepo(stderr: string): boolean {
  return (
    stderr.includes('does not have any commits yet') ||
    stderr.includes('no commits yet') ||
    stderr.includes("ambiguous argument 'HEAD'") ||
    stderr.includes('unknown revision or path')
  );
}

/**
 * Classify a git error into a structured result type.
 * Covers: git not installed, not a repo, permission denied, empty repo,
 * or a generic error with the raw message.
 */
function classifyError(
  errMessage: string
): { status: 'not_found' } | { status: 'error'; message: string } {
  if (isGitNotInstalled(errMessage)) {
    return { status: 'error', message: 'git is not installed or not in PATH' };
  }
  if (isNotAGitRepo(errMessage)) {
    return { status: 'not_found' };
  }
  if (isPermissionDenied(errMessage)) {
    return { status: 'error', message: `Permission denied: ${errMessage}` };
  }
  return { status: 'error', message: errMessage.trim() };
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Returns `true` if `workingDir` is inside a git repository.
 * Returns `false` for non-git directories, missing git, or any error.
 */
export async function isGitRepo(workingDir: string): Promise<boolean> {
  const result = await runGit('rev-parse --git-dir', workingDir);
  if ('error' in result) return false;
  return result.stdout.trim().length > 0;
}

/**
 * Returns the current branch name for the repository at `workingDir`.
 *
 * For a detached HEAD, returns `{ status: 'available', branch: 'HEAD' }`.
 * For a non-git directory, returns `{ status: 'not_found' }`.
 */
export async function getBranch(workingDir: string): Promise<GitBranchResult> {
  const result = await runGit('rev-parse --abbrev-ref HEAD', workingDir);

  if ('error' in result) {
    const errMsg = result.error.message;
    // Empty repo: HEAD reference doesn't exist yet
    if (
      errMsg.includes('unknown revision') ||
      errMsg.includes('No such file or directory') ||
      errMsg.includes('does not have any commits')
    ) {
      return { status: 'available', branch: 'HEAD' };
    }
    return classifyError(errMsg);
  }

  const branch = result.stdout.trim();
  if (!branch) {
    return { status: 'error', message: 'git rev-parse returned empty output' };
  }

  return { status: 'available', branch };
}

/**
 * Returns `true` if the working tree has uncommitted changes (staged or unstaged).
 * Returns `false` for a clean tree, empty repo, or non-git directory.
 */
export async function isDirty(workingDir: string): Promise<boolean> {
  const result = await runGit('status --porcelain', workingDir);
  if ('error' in result) return false;
  return result.stdout.trim().length > 0;
}

/**
 * Parses `--stat` output into a `GitDiffStat`.
 * Input: the summary line, e.g. "3 files changed, 45 insertions(+), 12 deletions(-)"
 * Returns zero values if the tree is clean or the line cannot be parsed.
 *
 * Exported for direct unit testing.
 */
export function parseDiffStatLine(statLine: string): GitDiffStat {
  const filesMatch = statLine.match(/(\d+)\s+file/);
  const insertMatch = statLine.match(/(\d+)\s+insertion/);
  const deleteMatch = statLine.match(/(\d+)\s+deletion/);
  return {
    filesChanged: filesMatch ? parseInt(filesMatch[1]!, 10) : 0,
    insertions: insertMatch ? parseInt(insertMatch[1]!, 10) : 0,
    deletions: deleteMatch ? parseInt(deleteMatch[1]!, 10) : 0,
  };
}

/**
 * Returns diff statistics (files changed, insertions, deletions) for the current
 * working tree against HEAD (`git diff HEAD --stat`).
 *
 * Returns zero-value stats for a clean tree (no changes).
 */
export async function getDiffStat(workingDir: string): Promise<GitDiffStatResult> {
  const result = await runGit('diff HEAD --stat', workingDir);

  if ('error' in result) {
    const errMsg = result.error.message;
    if (isEmptyRepo(result.error.message)) {
      return { status: 'no_commits' };
    }
    const classified = classifyError(errMsg);
    if (classified.status === 'not_found') return { status: 'not_found' };
    // Also check stderr embedded in error message for empty repo clues
    return classified;
  }

  // git diff exits 0 for both clean and dirty trees
  const output = result.stdout;
  const stderr = result.stderr;

  if (isEmptyRepo(stderr)) {
    return { status: 'no_commits' };
  }

  if (!output.trim()) {
    // Clean tree — zero changes
    return {
      status: 'available',
      diffStat: { filesChanged: 0, insertions: 0, deletions: 0 },
    };
  }

  // The summary line is the last non-empty line
  const lines = output.trim().split('\n');
  const summaryLine = lines[lines.length - 1] ?? '';
  const diffStat = parseDiffStatLine(summaryLine);

  return { status: 'available', diffStat };
}

/**
 * Returns the full unified diff for the current working tree against HEAD.
 * Content is capped at `FULL_DIFF_MAX_BYTES` (500 KB).
 *
 * Note: Binary files appear as "Binary files differ" in the output — handled
 * transparently (no special treatment needed; output is valid UTF-8 text).
 */
export async function getFullDiff(workingDir: string): Promise<GitFullDiffResult> {
  const result = await runGit('diff HEAD', workingDir);

  if ('error' in result) {
    const errMsg = result.error.message;
    if (isEmptyRepo(errMsg)) {
      return { status: 'no_commits' };
    }
    const classified = classifyError(errMsg);
    if (classified.status === 'not_found') return { status: 'not_found' };
    return classified;
  }

  const stderr = result.stderr;
  if (isEmptyRepo(stderr)) {
    return { status: 'no_commits' };
  }

  const raw = result.stdout;
  const byteLength = Buffer.byteLength(raw, 'utf8');

  if (byteLength > FULL_DIFF_MAX_BYTES) {
    // Truncate at a safe character boundary
    const truncated = Buffer.from(raw, 'utf8').subarray(0, FULL_DIFF_MAX_BYTES).toString('utf8');
    return { status: 'truncated', content: truncated, truncated: true };
  }

  return { status: 'available', content: raw, truncated: false };
}

/**
 * Returns up to `count` recent commits from the current branch.
 * Default: 20 commits. Optional `skip` to paginate (0-based offset).
 *
 * Returns an empty array for an empty repository (no commits).
 * Returns an empty array for non-git directories (does not throw).
 */
export async function getRecentCommits(
  workingDir: string,
  count = 20,
  skip = 0
): Promise<GitCommit[]> {
  // Use a null-byte separator to safely handle multi-line messages
  const format = '%H%x00%h%x00%s%x00%an%x00%aI';
  const skipArg = skip > 0 ? ` --skip=${skip}` : '';
  const result = await runGit(`log -${count}${skipArg} --format=${format}`, workingDir);

  if ('error' in result) {
    // Empty repo or non-git directory — return empty list, not an error
    return [];
  }

  const output = result.stdout.trim();
  if (!output) return [];

  const commits: GitCommit[] = [];
  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split('\x00');
    if (parts.length !== 5) continue;
    const [sha, shortSha, message, author, date] = parts as [
      string,
      string,
      string,
      string,
      string,
    ];
    commits.push({ sha, shortSha, message, author, date });
  }

  return commits;
}

/**
 * Returns the full diff for a specific commit SHA (`git show <sha>`).
 * Content is capped at `FULL_DIFF_MAX_BYTES` (500 KB).
 *
 * Returns `{ status: 'not_found' }` if the SHA does not exist in the
 * repository, or if the repository has no commits yet (empty repo).
 */
export async function getCommitDetail(
  workingDir: string,
  sha: string
): Promise<GitCommitDetailResult> {
  // --format="" suppresses the commit header; we only want the diff
  const result = await runGit(`show ${sha} --format="" --stat -p`, workingDir);

  if ('error' in result) {
    const errMsg = result.error.message;

    // Non-git directory: return not_found
    const classified = classifyError(errMsg);
    if (classified.status === 'not_found') return { status: 'not_found' };

    // Empty repo or non-existent SHA → not_found.
    // Distinguishing "sha doesn't exist" from "no commits yet" is not useful to callers.
    if (
      isEmptyRepo(errMsg) ||
      errMsg.includes('unknown revision') ||
      errMsg.includes('bad object') ||
      errMsg.includes('does not exist')
    ) {
      return { status: 'not_found' };
    }

    return classified;
  }

  const raw = result.stdout;
  const byteLength = Buffer.byteLength(raw, 'utf8');

  if (byteLength > FULL_DIFF_MAX_BYTES) {
    const truncated = Buffer.from(raw, 'utf8').subarray(0, FULL_DIFF_MAX_BYTES).toString('utf8');
    return { status: 'truncated', content: truncated, truncated: true };
  }

  return { status: 'available', content: raw, truncated: false };
}

/**
 * Returns commit metadata (message, author, date) for a specific SHA.
 *
 * Uses `git log -1 --format=...` with null-byte separators for safe parsing.
 * Returns `null` if the SHA is not found or the directory is not a git repo.
 */
export async function getCommitMetadata(
  workingDir: string,
  sha: string
): Promise<{ message: string; author: string; date: string } | null> {
  const format = '%s%x00%an%x00%aI';
  const result = await runGit(`log -1 --format=${format} ${sha}`, workingDir);
  if ('error' in result) return null;
  const output = result.stdout.trim();
  if (!output) return null;
  const parts = output.split('\x00');
  if (parts.length !== 3) return null;
  return { message: parts[0]!, author: parts[1]!, date: parts[2]! };
}
