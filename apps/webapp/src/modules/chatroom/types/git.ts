/**
 * Workspace Git — Frontend Types
 *
 * Re-exports shared domain types from the backend and adds
 * frontend-specific discriminated unions for on-demand data states.
 */

// ─── Shared Domain Types ──────────────────────────────────────────────────────

export type {
  DiffStat,
  GitCommit,
  WorkspaceGitState,
} from '@workspace/backend/src/domain/types/workspace-git';

// ─── Frontend-Specific State Types ───────────────────────────────────────────

import type { DiffStat } from '@workspace/backend/src/domain/types/workspace-git';

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
  | { status: 'error'; message: string };
