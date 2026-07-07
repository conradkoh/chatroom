/**
 * Git command execution wrappers.
 *
 * All functions return discriminated unions — no throws.
 * Errors from git (non-zero exit) or missing git installation are
 * captured and returned as `{ status: 'error' }` or `{ status: 'not_found' }`.
 */

import { runGh, runGit } from './run-command.js';
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

// ─── Internal Helpers ────────────────────────────────────────────────────────

function repoArgs(repoSlug: string | null): string[] {
  return repoSlug ? ['--repo', repoSlug] : [];
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

const NULL_DEVICE = process.platform === 'win32' ? 'NUL' : '/dev/null';

/** Lists untracked file paths (respecting .gitignore). */
async function listUntrackedFiles(workingDir: string): Promise<string[]> {
  const result = await runGit(['ls-files', '--others', '--exclude-standard'], workingDir);
  if ('error' in result) return [];
  return result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

/** Unified diff for a single untracked file (compare against /dev/null). */
async function getUntrackedFileDiff(workingDir: string, filePath: string): Promise<string> {
  const result = await runGit(['diff', '--no-index', '--', NULL_DEVICE, filePath], workingDir, {
    successExitCodes: [0, 1],
  });
  if ('error' in result) return '';
  return result.stdout;
}

/** Counts addition lines in unified diff output. */
function countDiffInsertions(diff: string): number {
  let count = 0;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) count++;
  }
  return count;
}

/** Merges tracked diff stat with untracked file contributions. */
function mergeDiffStatWithUntracked(base: DiffStat, untrackedDiffs: string[]): DiffStat {
  const untrackedInsertions = untrackedDiffs.reduce(
    (sum, diff) => sum + countDiffInsertions(diff),
    0
  );
  return {
    filesChanged: base.filesChanged + untrackedDiffs.length,
    insertions: base.insertions + untrackedInsertions,
    deletions: base.deletions,
  };
}

async function appendUntrackedDiffs(workingDir: string, trackedDiff: string): Promise<string> {
  const untrackedPaths = await listUntrackedFiles(workingDir);
  if (untrackedPaths.length === 0) return trackedDiff;

  const parts: string[] = [];
  if (trackedDiff.trim()) parts.push(trackedDiff.trimEnd());

  for (const filePath of untrackedPaths) {
    const fileDiff = await getUntrackedFileDiff(workingDir, filePath);
    if (fileDiff.trim()) parts.push(fileDiff.trimEnd());
  }

  if (parts.length === 0) return trackedDiff;
  return `${parts.join('\n')}\n`;
}

async function getUntrackedDiffs(workingDir: string): Promise<string[]> {
  const untrackedPaths = await listUntrackedFiles(workingDir);
  const diffs: string[] = [];
  for (const filePath of untrackedPaths) {
    const fileDiff = await getUntrackedFileDiff(workingDir, filePath);
    if (fileDiff.trim()) diffs.push(fileDiff);
  }
  return diffs;
}

function truncateDiffContent(raw: string): GitFullDiffResult {
  const byteLength = Buffer.byteLength(raw, 'utf8');
  if (byteLength > FULL_DIFF_MAX_BYTES) {
    const truncated = Buffer.from(raw, 'utf8').subarray(0, FULL_DIFF_MAX_BYTES).toString('utf8');
    return { status: 'truncated', content: truncated, truncated: true };
  }
  return { status: 'available', content: raw, truncated: false };
}

type TrackedHeadDiffResolution =
  | { status: 'ok'; stdout: string }
  | { status: 'empty_repo' }
  | { status: 'not_found' }
  | { status: 'error'; message: string };

async function runTrackedHeadDiff(
  workingDir: string,
  args: string[],
  options?: { maxBuffer?: number }
): Promise<TrackedHeadDiffResolution> {
  const result = await runGit(args, workingDir, options);
  if ('error' in result) {
    const errMsg = result.error.message;
    if (isEmptyRepo(errMsg)) return { status: 'empty_repo' };
    const classified = classifyError(errMsg);
    if (classified.status === 'not_found') return { status: 'not_found' };
    if (classified.status === 'error') return { status: 'error', message: classified.message };
    return { status: 'not_found' };
  }
  if (isEmptyRepo(result.stderr)) return { status: 'empty_repo' };
  return { status: 'ok', stdout: result.stdout };
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
  const result = await runGit(['rev-parse', '--git-dir'], workingDir);
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
  const result = await runGit(['rev-parse', '--abbrev-ref', 'HEAD'], workingDir);

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
  const result = await runGit(['status', '--porcelain'], workingDir);
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
    filesChanged: filesMatch ? parseInt(filesMatch[1] ?? '0', 10) : 0,
    insertions: insertMatch ? parseInt(insertMatch[1] ?? '0', 10) : 0,
    deletions: deleteMatch ? parseInt(deleteMatch[1] ?? '0', 10) : 0,
  };
}

/**
 * Returns diff statistics (files changed, insertions, deletions) for the current
 * working tree against HEAD (`git diff HEAD --stat`).
 *
 * Returns zero-value stats for a clean tree (no changes).
 */
export async function getDiffStat(workingDir: string): Promise<GitDiffStatResult> {
  const tracked = await runTrackedHeadDiff(workingDir, ['diff', 'HEAD', '--stat']);
  if (tracked.status === 'not_found') return { status: 'not_found' };
  if (tracked.status === 'error') return { status: 'error', message: tracked.message };

  let baseStat: DiffStat = { filesChanged: 0, insertions: 0, deletions: 0 };
  const hadEmptyRepo = tracked.status === 'empty_repo';
  if (tracked.status === 'ok' && tracked.stdout.trim()) {
    const lines = tracked.stdout.trim().split('\n');
    baseStat = parseDiffStatLine(lines[lines.length - 1] ?? '');
  }

  const untrackedDiffs = await getUntrackedDiffs(workingDir);
  if (untrackedDiffs.length === 0) {
    if (hadEmptyRepo) return { status: 'no_commits' };
    return { status: 'available', diffStat: baseStat };
  }

  return { status: 'available', diffStat: mergeDiffStatWithUntracked(baseStat, untrackedDiffs) };
}

/**
 * Returns the full unified diff for the current working tree against HEAD.
 * Content is capped at `FULL_DIFF_MAX_BYTES` (500 KB).
 *
 * Note: Binary files appear as "Binary files differ" in the output — handled
 * transparently (no special treatment needed; output is valid UTF-8 text).
 */
export async function getFullDiff(workingDir: string): Promise<GitFullDiffResult> {
  const tracked = await runTrackedHeadDiff(workingDir, ['diff', 'HEAD'], {
    maxBuffer: FULL_DIFF_MAX_BYTES + 64 * 1024,
  });
  if (tracked.status === 'not_found') return { status: 'not_found' };
  if (tracked.status === 'error') return { status: 'error', message: tracked.message };

  const trackedDiff = tracked.status === 'ok' ? tracked.stdout : '';
  const hadEmptyRepo = tracked.status === 'empty_repo';
  const content = await appendUntrackedDiffs(workingDir, trackedDiff);
  if (!content.trim()) {
    return hadEmptyRepo
      ? { status: 'no_commits' }
      : { status: 'available', content: '', truncated: false };
  }

  return truncateDiffContent(content);
}

/**
 * Returns the diff for a specific PR by number using `gh pr diff <number>`.
 * Content is capped at `FULL_DIFF_MAX_BYTES` (500 KB).
 */
export async function getPRDiffByNumber(cwd: string, prNumber: number): Promise<GitFullDiffResult> {
  const repoSlug = await getOriginRepoSlug(cwd);

  const result = await runGh(['pr', 'diff', String(prNumber), ...repoArgs(repoSlug)], cwd);

  if ('error' in result) {
    return { status: 'error', message: result.error.message };
  }

  const raw = result.stdout;
  if (!raw.trim()) {
    return { status: 'available', content: '', truncated: false };
  }

  return truncateDiffContent(raw);
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
  // Use US (\x1f) as field separator and RS (\x1e) as record terminator.
  // This is safer than \x00 when %b (body) can span multiple lines.
  // Neither \x1f nor \x1e appears in real-world commit messages.
  const format = '%H%x1f%h%x1f%s%x1f%b%x1f%an%x1f%aI%x1e';
  const logArgs = ['log', `-${count}`];
  if (skip > 0) logArgs.push(`--skip=${skip}`);
  logArgs.push(`--format=${format}`);
  const result = await runGit(logArgs, workingDir);

  if ('error' in result) {
    // Empty repo or non-git directory — return empty list, not an error
    return [];
  }

  const output = result.stdout.trim();
  if (!output) return [];

  const commits: GitCommit[] = [];
  for (const record of output.split('\x1e')) {
    const trimmed = record.trim();
    if (!trimmed) continue;
    const parts = trimmed.split('\x1f');
    if (parts.length !== 6) continue;
    const [sha, shortSha, message, rawBody, author, date] = parts as [
      string,
      string,
      string,
      string,
      string,
      string,
    ];
    const body = rawBody.trim();
    commits.push({ sha, shortSha, message, ...(body ? { body } : {}), author, date });
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
  const result = await runGit(['show', sha, '--format=', '--stat', '-p'], workingDir);

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
): Promise<{ message: string; body?: string; author: string; date: string } | null> {
  // Use US (\x1f) as field separator. %b may contain newlines but not \x1f.
  const format = '%s%x1f%b%x1f%an%x1f%aI';
  const result = await runGit(['log', '-1', `--format=${format}`, sha], workingDir);
  if ('error' in result) return null;
  const output = result.stdout.trim();
  if (!output) return null;
  const parts = output.split('\x1f');
  if (parts.length !== 4) return null;
  const [message, rawBody, author, date] = parts as [string, string, string, string];
  const body = rawBody.trim();
  return { message, ...(body ? { body } : {}), author, date };
}

// ─── GitHub CLI Integration ──────────────────────────────────────────────────

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
  const result = await runGit(['remote', 'get-url', 'origin'], cwd);
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
export async function getOpenPRsForBranch(cwd: string, branch: string): Promise<GitPullRequest[]> {
  // Resolve the origin repo slug to target the correct repository
  const repoSlug = await getOriginRepoSlug(cwd);
  const repoOwner = repoSlug?.split('/')[0] ?? null;

  const result = await runGh(
    [
      'pr',
      'list',
      '--head',
      branch,
      '--state',
      'open',
      '--author',
      '@me',
      '--json',
      'number,title,url,headRefName,state,headRepositoryOwner',
      '--limit',
      '5',
      ...repoArgs(repoSlug),
    ],
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
        (
          item: unknown
        ): item is {
          number: number;
          title: string;
          url: string;
          headRefName: string;
          state: string;
          headRepositoryOwner?: { login?: string };
        } =>
          typeof item === 'object' &&
          item !== null &&
          typeof (item as Record<string, unknown>).number === 'number' &&
          typeof (item as Record<string, unknown>).title === 'string' &&
          typeof (item as Record<string, unknown>).url === 'string' &&
          typeof (item as Record<string, unknown>).headRefName === 'string' &&
          typeof (item as Record<string, unknown>).state === 'string'
      )
      .filter((item) => {
        // Filter out cross-fork PRs: only include PRs from the same repo owner
        // This prevents PRs from forks (e.g., fork's main → upstream's main) from showing
        if (!repoOwner || !item.headRepositoryOwner?.login) return true;
        return item.headRepositoryOwner.login === repoOwner;
      })
      .map((item) => ({
        prNumber: item.number,
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
export async function getAllPRs(cwd: string): Promise<GitPullRequest[]> {
  const repoSlug = await getOriginRepoSlug(cwd);

  const result = await runGh(
    [
      'pr',
      'list',
      '--limit',
      '20',
      '--state',
      'all',
      '--json',
      'number,title,state,headRefName,baseRefName,url,author,createdAt,updatedAt,mergedAt,closedAt,isDraft',
      ...repoArgs(repoSlug),
    ],
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

    return parsed.filter(isGHPRItem).map((item): GitPullRequest => {
      const author =
        typeof item.author === 'object' && item.author !== null
          ? (item.author as { login?: string }).login
          : undefined;
      return {
        prNumber: item.number,
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

/** A commit entry from `gh pr view --json commits`. */
export interface PRCommitEntry {
  sha: string;
  shortSha: string;
  message: string;
  author: string;
  date: string;
}

/**
 * Get the list of commits for a specific PR number.
 * Uses `gh pr view <number> --json commits`.
 */
export async function getPRCommits(cwd: string, prNumber: number): Promise<PRCommitEntry[]> {
  const repoSlug = await getOriginRepoSlug(cwd);

  const result = await runGh(
    ['pr', 'view', String(prNumber), '--json', 'commits', ...repoArgs(repoSlug)],
    cwd
  );

  if ('error' in result) {
    return [];
  }

  const output = result.stdout.trim();
  if (!output) return [];

  try {
    const parsed: unknown = JSON.parse(output);
    if (typeof parsed !== 'object' || parsed === null || !('commits' in parsed)) return [];
    const commits = (parsed as { commits: unknown[] }).commits;
    if (!Array.isArray(commits)) return [];

    return commits.map((c: unknown): PRCommitEntry => {
      const commit = c as Record<string, unknown>;
      const oid = typeof commit.oid === 'string' ? commit.oid : '';
      const headline = typeof commit.messageHeadline === 'string' ? commit.messageHeadline : '';
      const date = typeof commit.committedDate === 'string' ? commit.committedDate : '';
      // Authors array
      let authorLogin = '';
      if (Array.isArray(commit.authors) && commit.authors.length > 0) {
        const first = commit.authors[0] as Record<string, unknown>;
        authorLogin =
          typeof first.login === 'string'
            ? first.login
            : typeof first.name === 'string'
              ? first.name
              : '';
      }
      return {
        sha: oid,
        shortSha: oid.slice(0, 7),
        message: headline,
        author: authorLogin,
        date,
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
  const result = await runGit(['remote', '-v'], cwd);
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
  const result = await runGit(['rev-list', '--count', '@{upstream}..HEAD'], workingDir);
  if ('error' in result) return 0;
  const count = parseInt(result.stdout.trim(), 10);
  return Number.isNaN(count) ? 0 : count;
}

/**
 * Returns the number of commits on the upstream tracking branch that are not
 * reachable from HEAD (i.e. unpulled commits).
 *
 * Uses `git rev-list --count HEAD..@{upstream}`.
 */
export async function getCommitsBehind(workingDir: string): Promise<number> {
  const result = await runGit(['rev-list', '--count', 'HEAD..@{upstream}'], workingDir);
  if ('error' in result) return 0;
  const count = parseInt(result.stdout.trim(), 10);
  return Number.isNaN(count) ? 0 : count;
}

// ─── Commit Status Checks ─────────────────────────────────────────────────────

/**
 * A single CI/CD check entry. Can originate from either a modern GitHub
 * Check Run (e.g. GitHub Actions) or a legacy Commit Status (e.g. older
 * Vercel deployments, Jenkins).
 *
 * Background: GitHub exposes two separate APIs:
 *   - `/commits/<ref>/check-runs`  — modern Check Runs API (GitHub Actions etc.)
 *   - `/commits/<ref>/statuses`    — legacy Commit Statuses API (Vercel deploy etc.)
 *
 * A real PR (#463) exhibited a green tick despite a failing Vercel deployment
 * because the legacy `/statuses` list was ignored. Both sources must be merged
 * to produce a correct aggregate state.
 */
export interface CommitStatusCheckRun {
  name: string;
  status: string; // 'completed' | 'in_progress' | 'queued'
  conclusion: string | null; // 'success' | 'failure' | 'skipped' | 'cancelled' | 'neutral' | 'pending' | 'error' | null
}

/** Combined commit status check result. */
export interface CommitStatusCheck {
  /** Overall combined status: 'success' | 'failure' | 'pending' | 'error' | 'neutral' */
  state: string;
  /** Individual check runs */
  checkRuns: CommitStatusCheckRun[];
  /** Total number of status checks */
  totalCount: number;
}

/**
 * Get CI/CD commit status checks for a given ref (branch or SHA).
 *
 * Merges BOTH modern Check Runs and legacy Commit Statuses into a single list.
 * This is required because the two APIs are orthogonal on GitHub:
 *
 *   - `/commits/<ref>/check-runs`  — GitHub Actions, newer third-party integrations
 *   - `/commits/<ref>/statuses`    — Vercel deployments (classic), Jenkins, older CI tools
 *
 * Canonical reproduction (PR #463): Vercel’s deploy status comes via the legacy
 * `/statuses` API with state='failure'. Without merging, this failure is invisible
 * — the UI shows a green tick because check-runs were all successful.
 *
 * Aggregation (failure wins):
 *   - any conclusion in ('failure','timed_out','cancelled','error') → state='failure'
 *   - else any entry still in progress (status !== 'completed') → state='pending'
 *   - else all completed and none failed → state='success'
 *
 * Legacy status `state` → (status, conclusion) mapping:
 *   - 'success' → status='completed', conclusion='success'
 *   - 'failure' | 'error' → status='completed', conclusion='failure'
 *   - 'pending' → status='in_progress', conclusion=null
 *
 * Returns null if `gh` is unavailable or any error occurs (non-blocking).
 */
export async function getCommitStatusChecks(
  cwd: string,
  ref: string
): Promise<CommitStatusCheck | null> {
  const repoSlug = await getOriginRepoSlug(cwd);
  if (!repoSlug) return null;

  try {
    // Fetch modern check-runs and legacy statuses list in parallel
    const [checkRunsResult, legacyStatusesResult] = await Promise.all([
      runGh(
        [
          'api',
          `repos/${repoSlug}/commits/${encodeURIComponent(ref)}/check-runs`,
          '--jq',
          '{check_runs: [.check_runs[] | {name: .name, status: .status, conclusion: .conclusion}], total_count: .total_count}',
        ],
        cwd
      ),
      runGh(
        [
          'api',
          `repos/${repoSlug}/commits/${encodeURIComponent(ref)}/statuses`,
          '--jq',
          '[group_by(.context)[] | max_by(.created_at) | {context: .context, state: .state, target_url: .target_url}]',
        ],
        cwd
      ),
    ]);

    if ('error' in checkRunsResult || 'error' in legacyStatusesResult) return null;

    const checkRunsData = JSON.parse(checkRunsResult.stdout.trim()) as {
      check_runs: { name: string; status: string; conclusion: string | null }[];
      total_count: number;
    };

    const legacyStatuses = JSON.parse(legacyStatusesResult.stdout.trim()) as {
      context: string;
      state: string;
      target_url: string | null;
    }[];

    // Normalize modern check-runs
    const modernEntries: CommitStatusCheckRun[] = checkRunsData.check_runs.map((cr) => ({
      name: cr.name,
      status: cr.status,
      conclusion: cr.conclusion,
    }));

    // Normalize legacy statuses
    const legacyEntries: CommitStatusCheckRun[] = legacyStatuses.map((s) => {
      let status: string;
      let conclusion: string | null;
      switch (s.state) {
        case 'success':
          status = 'completed';
          conclusion = 'success';
          break;
        case 'failure':
        case 'error':
          status = 'completed';
          conclusion = 'failure';
          break;
        default: // 'pending'
          status = 'in_progress';
          conclusion = null;
      }
      return {
        name: s.context,
        status,
        conclusion,
      };
    });

    const merged = [...modernEntries, ...legacyEntries];

    // Aggregation: failure wins
    const FAILURE_CONCLUSIONS = new Set(['failure', 'timed_out', 'cancelled', 'error']);
    let state: string;
    if (merged.some((e) => e.conclusion !== null && FAILURE_CONCLUSIONS.has(e.conclusion))) {
      state = 'failure';
    } else if (merged.some((e) => e.status !== 'completed')) {
      state = 'pending';
    } else {
      state = 'success';
    }

    return {
      state,
      checkRuns: merged,
      totalCount: merged.length,
    };
  } catch {
    return null;
  }
}

/**
 * Get the default branch name for the repository (e.g. 'main', 'master').
 *
 * Uses `gh api` to query the repo metadata.
 * Returns null if `gh` is unavailable or any error occurs.
 */
export async function getDefaultBranch(cwd: string): Promise<string | null> {
  const repoSlug = await getOriginRepoSlug(cwd);
  if (!repoSlug) return null;

  try {
    const result = await runGh(['api', `repos/${repoSlug}`, '--jq', '.default_branch'], cwd);
    if ('error' in result) return null;
    const branch = result.stdout.trim();
    return branch || null;
  } catch {
    return null;
  }
}
