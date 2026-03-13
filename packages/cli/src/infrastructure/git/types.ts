/**
 * Git infrastructure types.
 *
 * All result types use discriminated unions on a `status` field for
 * exhaustive handling — no optional fields for conditional state.
 */

// ─── Primitive Types ─────────────────────────────────────────────────────────

/** Diff summary statistics from `git diff HEAD --stat`. */
export interface GitDiffStat {
  filesChanged: number;
  insertions: number;
  deletions: number;
}

/** A single commit entry from `git log`. */
export interface GitCommit {
  /** Full 40-character SHA. */
  sha: string;
  /** 7-character abbreviated SHA. */
  shortSha: string;
  /** First line of the commit message. */
  message: string;
  /** Author display name. */
  author: string;
  /** ISO 8601 date string. */
  date: string;
}

// ─── Discriminated Union Results ─────────────────────────────────────────────

/**
 * Result of `getBranch`.
 *
 * - `available`: git is installed, directory is a repo, branch resolved
 * - `not_found`: directory is not a git repository
 * - `error`: unexpected failure (permission denied, git not installed, etc.)
 */
export type GitBranchResult =
  | { status: 'available'; branch: string }
  | { status: 'not_found' }
  | { status: 'error'; message: string };

/**
 * Result of `getDiffStat`.
 *
 * - `available`: diff stat parsed successfully (zero values if tree is clean)
 * - `not_found`: directory is not a git repository
 * - `no_commits`: repository exists but has no commits yet
 * - `error`: unexpected failure
 */
export type GitDiffStatResult =
  | { status: 'available'; diffStat: GitDiffStat }
  | { status: 'not_found' }
  | { status: 'no_commits' }
  | { status: 'error'; message: string };

/**
 * Result of `getFullDiff`.
 *
 * - `available`: diff content returned (may be empty string for clean tree)
 * - `truncated`: diff content was capped at `FULL_DIFF_MAX_BYTES` bytes
 * - `not_found`: directory is not a git repository
 * - `no_commits`: repository exists but has no commits yet
 * - `error`: unexpected failure
 */
export type GitFullDiffResult =
  | { status: 'available'; content: string; truncated: false }
  | { status: 'truncated'; content: string; truncated: true }
  | { status: 'not_found' }
  | { status: 'no_commits' }
  | { status: 'error'; message: string };

/**
 * Result of `getCommitDetail`.
 *
 * - `available`: commit diff returned
 * - `truncated`: commit diff was capped
 * - `not_found`: SHA does not exist in this repository
 * - `error`: unexpected failure
 */
export type GitCommitDetailResult =
  | { status: 'available'; content: string; truncated: false }
  | { status: 'truncated'; content: string; truncated: true }
  | { status: 'not_found' }
  | { status: 'error'; message: string };

/** Maximum byte size for full diff content before truncation. */
export const FULL_DIFF_MAX_BYTES = 500_000; // 500 KB
