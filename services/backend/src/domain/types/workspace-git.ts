/**
 * Workspace Git Domain Types
 *
 * All state types use discriminated unions on a `status` field for
 * exhaustive handling — no optional fields for conditional state.
 */

// ─── Primitive Types ─────────────────────────────────────────────────────────

/** Diff statistics summary. */
export interface DiffStat {
  filesChanged: number;
  insertions: number;
  deletions: number;
}

/** A single commit entry from the git log. */
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

/** Full diff content for the working tree or a specific commit. */
export interface FullDiff {
  /** Raw unified diff string (may be empty for a clean tree). */
  content: string;
  /** True if the content was capped at the size limit. */
  truncated: boolean;
  /** Stats derived from the diff. */
  diffStat: DiffStat;
}

/** Full diff content for a single commit (`git show <sha>`). */
export interface CommitDetail {
  sha: string;
  message: string;
  author: string;
  date: string;
  /** Raw unified diff string. */
  content: string;
  /** True if the content was capped at the size limit. */
  truncated: boolean;
  diffStat: DiffStat;
}

// ─── Workspace Git State (discriminated union) ────────────────────────────────

/**
 * The git state for a workspace (machineId + workingDir).
 *
 * - `loading`: initial state — daemon has not yet pushed data
 * - `available`: git data is present and up to date
 * - `not_found`: the working directory is not a git repository
 * - `error`: unexpected failure (git not installed, permission denied, etc.)
 */
export type WorkspaceGitState =
  | {
      status: 'loading';
    }
  | {
      status: 'available';
      branch: string;
      isDirty: boolean;
      diffStat: DiffStat;
      /** Recent commits from `git log -20`. May be empty for a clean repo. */
      recentCommits: GitCommit[];
      /** True if there are more commits beyond the current page. */
      hasMoreCommits: boolean;
      /** Unix timestamp (ms) when this state was last pushed by the daemon. */
      updatedAt: number;
    }
  | {
      status: 'not_found';
      /** Unix timestamp (ms) when the not-found state was last pushed. */
      updatedAt: number;
    }
  | {
      status: 'error';
      message: string;
      /** Unix timestamp (ms) when the error was last recorded. */
      updatedAt: number;
    };

// ─── On-Demand Request Types ─────────────────────────────────────────────────

/** Request for the full diff content of the working tree. */
export interface DiffRequest {
  machineId: string;
  workingDir: string;
}

/** Request for the full diff of a specific commit SHA. */
export interface CommitDetailRequest {
  machineId: string;
  workingDir: string;
  sha: string;
}

/** Request to load more commits (pagination). */
export interface MoreCommitsRequest {
  machineId: string;
  workingDir: string;
  /** How many commits to skip (e.g. 20 to load the next page after the first 20). */
  offset: number;
}
