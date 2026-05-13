'use client';

import { useMemo } from 'react';

import { useWorkspaceGit } from '../hooks/useWorkspaceGit';
import type { GitPullRequest } from '../types/git';

/**
 * Returns the current-branch PR for the active workspace, if any.
 *
 * Uses `gitState.openPullRequests[0]` which is the PR opened from the current
 * branch. This is the same logic used by the "Github: View Current Pull Request"
 * command-palette item.
 *
 * Also returns the current user's GitHub login (derived from the current-branch
 * PR author, if available) for "my PRs" filter support.
 */
export function useCurrentBranchPullRequest(
  machineId: string,
  workingDir: string
): {
  currentBranchPR: GitPullRequest | null;
  currentUserLogin: string | null;
} {
  const gitState = useWorkspaceGit(machineId, workingDir);

  const currentBranchPR = useMemo(() => {
    if (gitState.status !== 'available') return null;
    return gitState.openPullRequests[0] ?? null;
  }, [gitState]);

  const currentUserLogin = useMemo(() => {
    return currentBranchPR?.author ?? null;
  }, [currentBranchPR]);

  return { currentBranchPR, currentUserLogin };
}
