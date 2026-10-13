import type { Doc } from '@workspace/backend/convex/_generated/dataModel';
import {
  GIT_CLONE_ERROR_MESSAGES,
  type GitCloneErrorCode,
  type GitCloneStatus,
} from '@workspace/shared/domain/git-clone';

/** Equals the daemon.gitClone delivery window. An unclaimed command is dropped after this. */
const GIT_CLONE_PICKUP_TIMEOUT_MS = 5 * 60_000;
/** Four missed 30 s daemon keepalives. Progress older than this means the clone has stalled. */
const GIT_CLONE_STALL_MS = 2 * 60_000;

export type GitCloneViewState =
  | { kind: 'idle' }
  | { kind: 'waiting'; offline: boolean }
  | { kind: 'cloning'; phase: string; percent: number | null }
  | { kind: 'stalled' }
  | { kind: 'timed_out' }
  | { kind: 'completed'; clonedPath: string }
  | { kind: 'failed'; errorCode: GitCloneErrorCode; message: string; detail?: string | undefined };

type GitCloneRequest = Doc<'chatroom_gitCloneRequests'>;

function deriveWaiting(request: GitCloneRequest, now: number, isMachineConnected: boolean) {
  // Strictly greater: a request exactly at the timeout has not expired yet.
  if (now - request.createdAt > GIT_CLONE_PICKUP_TIMEOUT_MS) return { kind: 'timed_out' as const };
  return { kind: 'waiting' as const, offline: !isMachineConnected };
}

function deriveCloning(request: GitCloneRequest, now: number) {
  if (now - request.updatedAt > GIT_CLONE_STALL_MS) return { kind: 'stalled' as const };
  return {
    kind: 'cloning' as const,
    phase: request.progressPhase ?? '',
    percent: request.progressPercent ?? null,
  };
}

function deriveCompleted(request: GitCloneRequest) {
  return { kind: 'completed' as const, clonedPath: request.targetPath };
}

function deriveFailed(request: GitCloneRequest) {
  const errorCode = request.errorCode ?? 'unknown';
  return {
    kind: 'failed' as const,
    errorCode,
    message: GIT_CLONE_ERROR_MESSAGES[errorCode],
    detail: request.errorMessage,
  };
}

/** Per-status derivation. Each entry receives the request, the clock, and whether the machine is connected. */
const DERIVE_BY_STATUS: Record<
  GitCloneStatus,
  (request: GitCloneRequest, now: number, isMachineConnected: boolean) => GitCloneViewState
> = {
  pending: deriveWaiting,
  cloning: (request, now) => deriveCloning(request, now),
  completed: (request) => deriveCompleted(request),
  failed: (request) => deriveFailed(request),
};

/**
 * Maps a clone request to what the form should show. Pure: `now` is passed in so the
 * timeout and stall boundaries can be tested exactly.
 *
 * - no request yet → idle
 * - request still loading → waiting
 * - request missing or not visible to this user → failed (unknown)
 * - otherwise the status decides, see DERIVE_BY_STATUS
 */
export function deriveGitCloneViewState(
  request: GitCloneRequest | null | undefined,
  now: number,
  isMachineConnected: boolean,
  hasRequest: boolean
): GitCloneViewState {
  if (!hasRequest) return { kind: 'idle' };
  if (request === undefined) return { kind: 'waiting', offline: !isMachineConnected };
  if (request === null) {
    return { kind: 'failed', errorCode: 'unknown', message: GIT_CLONE_ERROR_MESSAGES.unknown };
  }
  return DERIVE_BY_STATUS[request.status](request, now, isMachineConnected);
}
