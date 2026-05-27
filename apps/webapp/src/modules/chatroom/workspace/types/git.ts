/**
 * Workspace Git — Frontend Types
 *
 * Re-exports shared domain types from the backend and adds
 * frontend-specific discriminated unions for on-demand data states.
 */

// ─── Shared Domain Types ──────────────────────────────────────────────────────

// ─── Frontend-Specific State Types ───────────────────────────────────────────

import type { DiffStat } from '@workspace/backend/src/domain/types/workspace-git';

export type {
  CommitStatusSummary,
  DiffStat,
  GitCommit,
  GitPullRequest,
  GitRemote,
  WorkspaceGitState,
} from '@workspace/backend/src/domain/types/workspace-git';

/**
 * State for an on-demand full diff request.
 *
 * - `idle`: no request made yet
 * - `loading`: request in flight
 * - `available`: diff content ready
 * - `error`: request failed
 */
export type FullDiffState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'available'; content: string; truncated: boolean; diffStat: DiffStat }
  | { status: 'error'; message: string };

/**
 * State for an on-demand commit detail request.
 *
 * - `idle`: no request made yet
 * - `loading`: request in flight
 * - `available`: commit detail ready
 * - `too_large`: commit diff is too large to display
 * - `not_found`: commit SHA does not exist in the repository
 * - `error`: request failed
 */
export type CommitDetailState =
  | { status: 'idle' }
  | { status: 'loading' }
  | {
      status: 'available';
      content: string;
      truncated: boolean;
      message: string;
      author: string;
      date: string;
      diffStat: DiffStat;
    }
  | { status: 'too_large'; message?: string; author?: string; date?: string }
  | { status: 'not_found' }
  | { status: 'error'; message: string };

/**
 * State for an on-demand PR diff request.
 * Same shape as FullDiffState.
 */
export type PRDiffState = FullDiffState;
