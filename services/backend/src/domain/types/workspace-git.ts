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

/** An open GitHub pull request for the current branch. */
export interface GitPullRequest {
  /** PR number (e.g. 42). */
  number: number;
  /** PR title. */
  title: string;
  /** Full URL to the PR on GitHub. */
  url: string;
  /** The head branch name that the PR was opened from. */
  headRefName: string;
  /** PR state (e.g. 'OPEN'). */
  state: string;
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
      /** Open pull requests for the current branch. Empty if none or gh unavailable. */
      openPullRequests: GitPullRequest[];
      /** Configured git remotes (e.g. origin, upstream). */
      remotes: GitRemote[];
      /** Number of commits ahead of the upstream tracking branch (unpushed). 0 if no upstream. */
      commitsAhead: number;
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

/** A configured git remote (from `git remote -v`). */
export interface GitRemote {
  /** Remote name (e.g. 'origin', 'upstream'). */
  name: string;
  /** Remote URL (HTTPS or SSH). */
  url: string;
}
