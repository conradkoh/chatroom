/**
 * Git infrastructure types.
 *
 * All result types use discriminated unions on a `status` field for
 * exhaustive handling — no optional fields for conditional state.
 */

import type { DiffStat, GitCommit, GitPullRequest } from '@workspace/backend/src/domain/types/workspace-git';

// Re-export backend domain types so existing consumers don't break.
export type { DiffStat, GitCommit, GitPullRequest };

// ─── Primitive Types ─────────────────────────────────────────────────────────

/** @deprecated Use `DiffStat` from the backend domain types. Alias kept for backward compatibility. */
export type GitDiffStat = DiffStat;

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

/** Number of commits to fetch per page for git history. */
export const COMMITS_PER_PAGE = 20;

/**
 * Creates a stable string key for indexing git state by workspace.
 * Format: `${machineId}::${workingDir}`
 *
 * Used as the key in `DaemonContext.lastPushedGitState` for change detection.
 */
export function makeGitStateKey(machineId: string, workingDir: string): string {
  return `${machineId}::${workingDir}`;
}
