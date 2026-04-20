/**
 * Workspace Git — React Hooks (real Convex queries)
 *
 * These hooks subscribe to live Convex queries for workspace git data
 * and call Convex mutations to request on-demand operations.
 */

'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import { useSessionQuery, useSessionMutation } from 'convex-helpers/react/sessions';
import { useState, useCallback, useMemo, useRef, useEffect } from 'react';

import type { WorkspaceGitState, FullDiffState, CommitDetailState, PRDiffState } from '../types/git';
import { decompressGzip, extractBase64Content } from '../utils/decompressGzip';

// ─── Hooks ────────────────────────────────────────────────────────────────────

/**
 * Returns the git state for a workspace (machine + working directory).
 *
 * Subscribes to live Convex updates. Returns `{ status: 'loading' }` while
 * the query is resolving or no data has been pushed by the daemon yet.
 */
export function useWorkspaceGit(machineId: string, workingDir: string): WorkspaceGitState {
  const shouldSkip = !machineId || !workingDir;
  const result = useSessionQuery(
    api.workspaces.getWorkspaceGitState,
    shouldSkip ? 'skip' : { machineId, workingDir }
  );

  // While the query is loading (undefined) or skipped, return loading state
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
  workingDir: string
): { state: FullDiffState; request: () => void } {
  const result = useSessionQuery(api.workspaces.getFullDiffV2, { machineId, workingDir });
  const requestMutation = useSessionMutation(api.workspaces.requestFullDiff);
  const requestedRef = useRef(false);
  const [decompressedContent, setDecompressedContent] = useState<string | null>(null);

  const request = useCallback(() => {
    requestedRef.current = true;
    requestMutation({ machineId, workingDir });
  }, [requestMutation, machineId, workingDir]);

  // V2: data is a compressed object { compression, content } — always decompress
  useEffect(() => {
    if (result && result.data) {
      let cancelled = false;
      decompressGzip(extractBase64Content(result.data))
        .then((content) => {
          if (!cancelled) setDecompressedContent(content);
        })
        .catch((err) => {
          console.error('[useFullDiff] Failed to decompress diff:', err);
          if (!cancelled) setDecompressedContent(null);
        });
      return () => { cancelled = true; };
    } else {
      setDecompressedContent(null);
    }
  }, [result]);

  const state: FullDiffState = useMemo(() => {
    if (!result) {
      return requestedRef.current ? { status: 'loading' } : { status: 'idle' };
    }

    return {
      status: 'available',
      content: decompressedContent ?? '',
      truncated: result.truncated,
      diffStat: result.diffStat,
    };
  }, [result, decompressedContent]);

  return { state, request };
}

/**
 * Returns the PR diff state and a request function.
 *
 * `request(baseBranch, prNumber)` triggers a daemon fetch for the PR diff.
 * The result is read from the `getPRDiff` query.
 * prNumber is REQUIRED — use getPRDiffByNumber for fetching by explicit PR number.
 */
export function usePRDiff(
  machineId: string,
  workingDir: string,
  prNumber: number
): { state: PRDiffState; request: (baseBranch: string, prNumber: number) => void } {
  const result = useSessionQuery(api.workspaces.getPRDiff, { machineId, workingDir, prNumber });
  const requestMutation = useSessionMutation(api.workspaces.requestPRDiff);
  const requestedRef = useRef(false);

  const request = useCallback(
    (baseBranch: string, prNumber: number) => {
      requestedRef.current = true;
      requestMutation({ machineId, workingDir, baseBranch, prNumber });
    },
    [requestMutation, machineId, workingDir]
  );

  const state: PRDiffState = useMemo(() => {
    if (!result) {
      return requestedRef.current ? { status: 'loading' } : { status: 'idle' };
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
  workingDir: string
): { state: CommitDetailState; request: (sha: string) => void; clear: () => void } {
  const [activeSha, setActiveSha] = useState<string | null>(null);
  const requestMutation = useSessionMutation(api.workspaces.requestCommitDetail);
  const [decompressedContent, setDecompressedContent] = useState<string | null>(null);

  // Only subscribe when we have a sha to fetch
  const result = useSessionQuery(
    api.workspaces.getCommitDetailV2,
    activeSha ? { machineId, workingDir, sha: activeSha } : 'skip'
  );

  const request = useCallback(
    (sha: string) => {
      setActiveSha(sha);
      requestMutation({ machineId, workingDir, sha });
    },
    [requestMutation, machineId, workingDir]
  );

  const clear = useCallback(() => {
    setActiveSha(null);
    setDecompressedContent(null);
  }, []);

  // V2: data is a compressed object when status=available — always decompress
  useEffect(() => {
    if (result && result.data) {
      let cancelled = false;
      decompressGzip(extractBase64Content(result.data))
        .then((content) => {
          if (!cancelled) setDecompressedContent(content);
        })
        .catch((err) => {
          console.error('[useCommitDetail] Failed to decompress commit detail:', err);
          if (!cancelled) setDecompressedContent(null);
        });
      return () => { cancelled = true; };
    } else {
      setDecompressedContent(null);
    }
  }, [result]);

  const state: CommitDetailState = useMemo(() => {
    if (!activeSha) return { status: 'idle' };
    if (result === undefined) return { status: 'loading' }; // query still loading
    if (result === null) return { status: 'loading' }; // no row yet
    if (result.status === 'available') {
      return {
        status: 'available',
        content: decompressedContent ?? '',
        truncated: result.truncated ?? false,
        message: result.message ?? '',
        author: result.author ?? '',
        date: result.date ?? '',
        diffStat: result.diffStat ?? { filesChanged: 0, insertions: 0, deletions: 0 },
      };
    }
    if (result.status === 'too_large') {
      return {
        status: 'too_large',
        message: result.message,
        author: result.author,
        date: result.date,
      };
    }
    if (result.status === 'not_found') {
      return { status: 'not_found' };
    }
    // error
    return { status: 'error', message: result.errorMessage ?? 'Unknown error' };
  }, [activeSha, result, decompressedContent]);

  return { state, request, clear };
}

// ─── PR Commit List Types ─────────────────────────────────────────────────────

export interface PRCommitEntry {
  sha: string;
  shortSha: string;
  message: string;
  author: string;
  date: string;
}

export type PRCommitsState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'available'; commits: PRCommitEntry[] };

/**
 * Returns the list of commits for a specific PR and a request function.
 *
 * `request()` triggers a daemon fetch for the PR's commits.
 * The result is read from the `getPRCommits` query.
 */
export function usePRCommits(
  machineId: string,
  workingDir: string,
  prNumber: number | null
): { state: PRCommitsState; request: () => void } {
  const requestMutation = useSessionMutation(api.workspaces.requestPRCommits);
  const requestedRef = useRef(false);

  const result = useSessionQuery(
    api.workspaces.getPRCommits,
    prNumber ? { machineId, workingDir, prNumber } : 'skip'
  );

  const request = useCallback(() => {
    if (!prNumber) return;
    requestedRef.current = true;
    requestMutation({ machineId, workingDir, prNumber });
  }, [requestMutation, machineId, workingDir, prNumber]);

  const state: PRCommitsState = useMemo(() => {
    if (!prNumber) return { status: 'idle' };
    if (!result) {
      return requestedRef.current ? { status: 'loading' } : { status: 'idle' };
    }
    return {
      status: 'available',
      commits: result.commits as PRCommitEntry[],
    };
  }, [prNumber, result]);

  return { state, request };
}

/**
 * Returns a loading flag and a loadMore function for paginating commits.
 *
 * `loadMore()` requests the next page of commits (offset = current length).
 * The daemon appends them to the git state via `appendMoreCommits`.
 */
export function useLoadMoreCommits(
  machineId: string,
  workingDir: string
): { loading: boolean; loadMore: () => void } {
  const [loading, setLoading] = useState(false);
  const requestMutation = useSessionMutation(api.workspaces.requestMoreCommits);
  const shouldSkipGit = !machineId || !workingDir;
  const gitState = useSessionQuery(
    api.workspaces.getWorkspaceGitState,
    shouldSkipGit ? 'skip' : { machineId, workingDir }
  );

  const loadMore = useCallback(() => {
    const currentCount =
      gitState?.status === 'available' ? (gitState.recentCommits?.length ?? 0) : 0;
    setLoading(true);
    requestMutation({ machineId, workingDir, offset: currentCount }).finally(() =>
      setLoading(false)
    );
  }, [requestMutation, machineId, workingDir, gitState]);

  return { loading, loadMore };
}

/**
 * Returns a function that triggers an on-demand git state refresh.
 *
 * Sends a daemon.gitRefresh event via the event stream. The daemon
 * responds by re-running pushGitState within milliseconds.
 * The live getWorkspaceGitState subscription updates automatically.
 */
export function useGitRefresh(
  machineId: string,
  workingDir: string
): { refresh: () => void; isRefreshing: boolean } {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const requestMutation = useSessionMutation(api.machines.requestGitRefresh);

  const refresh = useCallback(() => {
    setIsRefreshing(true);
    requestMutation({ machineId, workingDir }).finally(() => {
      // Show spinner for ~3s (daemon typically responds within 1-2s)
      setTimeout(() => setIsRefreshing(false), 3000);
    });
  }, [requestMutation, machineId, workingDir]);

  return { refresh, isRefreshing };
}
