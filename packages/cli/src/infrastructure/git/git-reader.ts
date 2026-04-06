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
  DiffStat,
  GitBranchResult,
  GitCommit,
  GitCommitDetailResult,
  GitDiffStatResult,
  GitFullDiffResult,
  GitPullRequest,
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
 * Parses `--stat` output into a `DiffStat`.
 * Input: the summary line, e.g. "3 files changed, 45 insertions(+), 12 deletions(-)"
 * Returns zero values if the tree is clean or the line cannot be parsed.
 *
 * Exported for direct unit testing.
 */
export function parseDiffStatLine(statLine: string): DiffStat {
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
 * Returns diff statistics for a PR (diff between origin/<baseBranch> and HEAD).
 * Uses three-dot syntax to diff from the merge-base.
 */
export async function getPRDiffStat(
  workingDir: string,
  baseBranch: string
): Promise<GitDiffStatResult> {
  const result = await runGit(`diff --stat origin/${baseBranch}...HEAD`, workingDir);

  if ('error' in result) {
    const errMsg = result.error.message;
    if (isEmptyRepo(errMsg)) {
      return { status: 'no_commits' };
    }
    const classified = classifyError(errMsg);
    if (classified.status === 'not_found') return { status: 'not_found' };
    return classified;
  }

  const output = result.stdout;
  const stderr = result.stderr;

  if (isEmptyRepo(stderr)) {
    return { status: 'no_commits' };
  }

  if (!output.trim()) {
    return {
      status: 'available',
      diffStat: { filesChanged: 0, insertions: 0, deletions: 0 },
    };
  }

  const lines = output.trim().split('\n');
  const summaryLine = lines[lines.length - 1] ?? '';
  const diffStat = parseDiffStatLine(summaryLine);

  return { status: 'available', diffStat };
}

/**
 * Returns the full unified PR diff (diff between origin/<baseBranch> and HEAD).
 * Uses three-dot syntax to diff from the merge-base.
 * Content is capped at `FULL_DIFF_MAX_BYTES` (500 KB).
 */
export async function getPRDiff(
  workingDir: string,
  baseBranch: string
): Promise<GitFullDiffResult> {
  const result = await runGit(`diff origin/${baseBranch}...HEAD`, workingDir);

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

// ─── GitHub CLI Integration ──────────────────────────────────────────────────

/**
 * Run an arbitrary command in `cwd`.
 * Returns `{ stdout, stderr }` on success, `{ error }` on failure.
 * Never throws.
 */
async function runCommand(
  command: string,
  cwd: string
): Promise<{ stdout: string; stderr: string } | { error: Error & { code?: number } }> {
  try {
    const result = await execAsync(command, {
      cwd,
      env: { ...process.env, NO_COLOR: '1' },
      timeout: 15_000, // 15s timeout for gh commands
    });
    return result;
  } catch (err) {
    return { error: err as Error & { code?: number } };
  }
}

/**
 * Parse a git remote URL into an `owner/repo` slug.
 * Handles both HTTPS and SSH URL formats, with or without `.git` suffix.
 *
 * Examples:
 *   https://github.com/owner/repo.git → owner/repo
 *   https://github.com/owner/repo     → owner/repo
 *   git@github.com:owner/repo.git     → owner/repo
 *   git@github.com:owner/repo         → owner/repo
 *
 * Returns `null` if the URL cannot be parsed.
 *
 * Exported for unit testing.
 */
export function parseRepoSlug(remoteUrl: string): string | null {
  const trimmed = remoteUrl.trim();

  // HTTPS format: https://github.com/owner/repo.git or https://github.com/owner/repo
  const httpsMatch = trimmed.match(/https?:\/\/[^/]+\/([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (httpsMatch && httpsMatch[1] && httpsMatch[2]) {
    return `${httpsMatch[1]}/${httpsMatch[2]}`;
  }

  // SSH format: git@github.com:owner/repo.git or git@github.com:owner/repo
  const sshMatch = trimmed.match(/git@[^:]+:([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (sshMatch && sshMatch[1] && sshMatch[2]) {
    return `${sshMatch[1]}/${sshMatch[2]}`;
  }

  return null;
}

/**
 * Get the `owner/repo` slug for the `origin` remote of the repository at `cwd`.
 *
 * Returns `null` if:
 * - The `origin` remote does not exist
 * - The URL cannot be parsed
 * - Any error occurs (graceful degradation)
 *
 * Exported for unit testing.
 */
export async function getOriginRepoSlug(cwd: string): Promise<string | null> {
  const result = await runGit('remote get-url origin', cwd);
  if ('error' in result) return null;

  const url = result.stdout.trim();
  if (!url) return null;

  return parseRepoSlug(url);
}

/**
 * Get open pull requests for the given branch using `gh pr list`.
 *
 * Returns an empty array if:
 * - The `gh` CLI is not installed
 * - The user is not authenticated with `gh`
 * - There are no open PRs for the branch
 * - Any error occurs (graceful degradation)
 */
export async function getOpenPRsForBranch(
  cwd: string,
  branch: string
): Promise<GitPullRequest[]> {
  // Resolve the origin repo slug to target the correct repository
  const repoSlug = await getOriginRepoSlug(cwd);
  const repoFlag = repoSlug ? ` --repo ${JSON.stringify(repoSlug)}` : '';

  const result = await runCommand(
    `gh pr list --head ${JSON.stringify(branch)} --state open --json number,title,url,headRefName,state --limit 5${repoFlag}`,
    cwd
  );

  if ('error' in result) {
    // gh not installed, not authenticated, or other failure — degrade gracefully
    return [];
  }

  const output = result.stdout.trim();
  if (!output) return [];

  try {
    const parsed: unknown = JSON.parse(output);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter(
        (item: unknown): item is { number: number; title: string; url: string; headRefName: string; state: string } =>
          typeof item === 'object' &&
          item !== null &&
          typeof (item as Record<string, unknown>).number === 'number' &&
          typeof (item as Record<string, unknown>).title === 'string' &&
          typeof (item as Record<string, unknown>).url === 'string' &&
          typeof (item as Record<string, unknown>).headRefName === 'string' &&
          typeof (item as Record<string, unknown>).state === 'string'
      )
      .map((item) => ({
        number: item.number,
        title: item.title,
        url: item.url,
        headRefName: item.headRefName,
        state: item.state,
      }));
  } catch {
    // JSON parse failure — degrade gracefully
    return [];
  }
}

/** Shape of a single PR item returned by `gh pr list --json ...`. */
interface GHPRItem {
  number: number;
  title: string;
  url?: string;
  headRefName?: string;
  baseRefName?: string;
  state?: string;
  author?: unknown;
  createdAt?: string;
  updatedAt?: string;
  mergedAt?: string | null;
  closedAt?: string | null;
  isDraft?: boolean;
}

function isGHPRItem(item: unknown): item is GHPRItem {
  return (
    typeof item === 'object' &&
    item !== null &&
    typeof (item as GHPRItem).number === 'number' &&
    typeof (item as GHPRItem).title === 'string'
  );
}

/**
 * Get all pull requests (open, closed, merged) for the repository using `gh pr list`.
 * Returns up to 20 most recent PRs.
 */
export async function getAllPRs(
  cwd: string
): Promise<GitPullRequest[]> {
  const repoSlug = await getOriginRepoSlug(cwd);
  const repoFlag = repoSlug ? ` --repo ${JSON.stringify(repoSlug)}` : '';

  const result = await runCommand(
    `gh pr list --limit 20 --state all --json number,title,state,headRefName,baseRefName,url,author,createdAt,updatedAt,mergedAt,closedAt,isDraft${repoFlag}`,
    cwd
  );

  if ('error' in result) {
    return [];
  }

  const output = result.stdout.trim();
  if (!output) return [];

  try {
    const parsed: unknown = JSON.parse(output);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter(isGHPRItem)
      .map((item): GitPullRequest => {
        const author = typeof item.author === 'object' && item.author !== null
          ? (item.author as { login?: string }).login
          : undefined;
        return {
          number: item.number,
          title: item.title,
          url: item.url ?? '',
          headRefName: item.headRefName ?? '',
          baseRefName: item.baseRefName ?? 'main',
          state: item.state ?? 'OPEN',
          author,
          createdAt: item.createdAt ?? undefined,
          updatedAt: item.updatedAt ?? undefined,
          mergedAt: item.mergedAt ?? null,
          closedAt: item.closedAt ?? null,
          isDraft: item.isDraft ?? false,
        };
      });
  } catch {
    return [];
  }
}

// ─── Git Remotes ────────────────────────────────────────────────────────────

/** A single git remote entry (from `git remote -v`). */
export interface GitRemoteEntry {
  /** Remote name (e.g. 'origin', 'upstream'). */
  name: string;
  /** Remote URL (HTTPS or SSH). */
  url: string;
}

/**
 * Get all configured git remotes for the repository at `cwd`.
 *
 * Runs `git remote -v` and deduplicates (keeping fetch entries).
 * Returns an empty array if no remotes are configured or the command fails.
 */
export async function getRemotes(cwd: string): Promise<GitRemoteEntry[]> {
  const result = await runGit('remote -v', cwd);
  if ('error' in result) return [];
  if (!result.stdout.trim()) return [];

  const lines = result.stdout.trim().split('\n');
  const seen = new Set<string>();
  const remotes: GitRemoteEntry[] = [];

  for (const line of lines) {
    // Format: "origin\thttps://github.com/user/repo.git (fetch)"
    const match = line.match(/^(\S+)\s+(\S+)\s+\((\w+)\)$/);
    if (!match) continue;

    const [, name, url, type] = match;
    if (!name || !url) continue;

    // Deduplicate — prefer fetch entry (listed first)
    if (type === 'fetch' && !seen.has(name)) {
      seen.add(name);
      remotes.push({ name, url });
    }
  }

  return remotes;
}

/**
 * Returns the number of commits on the current branch that are ahead of the
 * tracking remote branch (i.e. unpushed commits).
 *
 * Uses `git rev-list --count @{upstream}..HEAD` which counts commits reachable
 * from HEAD but not from the upstream tracking branch.
 *
 * Returns 0 if:
 *  - There is no upstream configured for the current branch
 *  - The repository has no commits
 *  - The directory is not a git repository
 *  - Any other error occurs
 *
 * This is intentionally lenient — unpushed count is supplementary info and
 * should never cause the git state push to fail.
 */
export async function getCommitsAhead(workingDir: string): Promise<number> {
  const result = await runGit('rev-list --count @{upstream}..HEAD', workingDir);
  if ('error' in result) return 0;
  const count = parseInt(result.stdout.trim(), 10);
  return Number.isNaN(count) ? 0 : count;
}
