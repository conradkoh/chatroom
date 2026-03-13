/**
 * Workspace Git — React Hooks (real Convex queries)
 *
 * These hooks subscribe to live Convex queries for workspace git data
 * and call Convex mutations to request on-demand operations.
 */

'use client';

import { useState, useCallback, useMemo } from 'react';
import { useSessionQuery, useSessionMutation } from 'convex-helpers/react/sessions';
import { api } from '@workspace/backend/convex/_generated/api';
import type {
  WorkspaceGitState,
  FullDiffState,
  CommitDetailState,
} from '../types/git';

// ─── Hooks ────────────────────────────────────────────────────────────────────

/**
 * Returns the git state for a workspace (machine + working directory).
 *
 * Subscribes to live Convex updates. Returns `{ status: 'loading' }` while
 * the query is resolving or no data has been pushed by the daemon yet.
 */
export function useWorkspaceGit(machineId: string, workingDir: string): WorkspaceGitState {
  const result = useSessionQuery(api.workspaces.getWorkspaceGitState, {
    machineId,
    workingDir,
  });

  // While the query is loading (undefined), return loading state
  if (!result) {
    return { status: 'loading' };
  }

  return result;
}

/**
 * Returns full diff state and a request function.
 *
 * `state` is `idle` until `request()` is called, then transitions to
 * `available` once the daemon fulfills the request (~5s).
 */
export function useFullDiff(
  machineId: string,
  workingDir: string,
): { state: FullDiffState; request: () => void } {
  const result = useSessionQuery(api.workspaces.getFullDiff, { machineId, workingDir });
  const requestMutation = useSessionMutation(api.workspaces.requestFullDiff);

  const request = useCallback(() => {
    requestMutation({ machineId, workingDir });
  }, [requestMutation, machineId, workingDir]);

  const state: FullDiffState = useMemo(() => {
    if (!result) {
      return { status: 'idle' };
    }
    return {
      status: 'available',
      content: result.diffContent,
      truncated: result.truncated,
      diffStat: result.diffStat,
    };
  }, [result]);

  return { state, request };
}

/**
 * Returns commit detail state, a request function, and a clear function.
 *
 * `request(sha)` triggers a daemon fetch for the given commit.
 * `clear()` resets back to `idle`.
 */
export function useCommitDetail(
  machineId: string,
  workingDir: string,
): { state: CommitDetailState; request: (sha: string) => void; clear: () => void } {
  const [activeSha, setActiveSha] = useState<string | null>(null);
  const requestMutation = useSessionMutation(api.workspaces.requestCommitDetail);

  // Only subscribe when we have a sha to fetch
  const result = useSessionQuery(
    api.workspaces.getCommitDetail,
    activeSha ? { machineId, workingDir, sha: activeSha } : 'skip',
  );

  const request = useCallback(
    (sha: string) => {
      setActiveSha(sha);
      requestMutation({ machineId, workingDir, sha });
    },
    [requestMutation, machineId, workingDir],
  );

  const clear = useCallback(() => {
    setActiveSha(null);
  }, []);

  const state: CommitDetailState = useMemo(() => {
    if (!activeSha) return { status: 'idle' };
    if (!result) return { status: 'loading' };
    return {
      status: 'available',
      content: result.diffContent,
      truncated: result.truncated,
      message: result.message,
      author: result.author,
      date: result.date,
      diffStat: result.diffStat,
    };
  }, [activeSha, result]);

  return { state, request, clear };
}

/**
 * Returns a loading flag and a loadMore function for paginating commits.
 *
 * `loadMore()` requests the next page of commits (offset = current length).
 * The daemon appends them to the git state via `appendMoreCommits`.
 */
export function useLoadMoreCommits(
  machineId: string,
  workingDir: string,
): { loading: boolean; loadMore: () => void } {
  const [loading, setLoading] = useState(false);
  const requestMutation = useSessionMutation(api.workspaces.requestMoreCommits);
  const gitState = useSessionQuery(api.workspaces.getWorkspaceGitState, { machineId, workingDir });

  const loadMore = useCallback(() => {
    const currentCount =
      gitState?.status === 'available' ? (gitState.recentCommits?.length ?? 0) : 0;
    setLoading(true);
    requestMutation({ machineId, workingDir, offset: currentCount }).finally(() =>
      setLoading(false),
    );
  }, [requestMutation, machineId, workingDir, gitState]);

  return { loading, loadMore };
}
