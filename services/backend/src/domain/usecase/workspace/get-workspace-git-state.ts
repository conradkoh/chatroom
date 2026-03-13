/**
 * Get Workspace Git State Use Case
 *
 * Returns the current git state for a workspace (machineId + workingDir).
 *
 * Phase 2: Returns mock data. Phase 5+ will query `chatroom_workspaceGitState`.
 */

import type { WorkspaceGitState } from '../../types/workspace-git';

/**
 * Returns the git state for the given workspace.
 *
 * Currently returns mock data so the frontend can be wired up before the
 * backend persistence layer is implemented.
 */
export function getWorkspaceGitState(
  _machineId: string,
  _workingDir: string
): WorkspaceGitState {
  // Mock response — will be replaced with DB lookup in Phase 5
  return {
    status: 'available',
    branch: 'main',
    isDirty: true,
    diffStat: {
      filesChanged: 3,
      insertions: 45,
      deletions: 12,
    },
    recentCommits: [
      {
        sha: 'abc1234567890abcdef1234567890abcdef123456',
        shortSha: 'abc1234',
        message: 'feat: add workspace git integration',
        author: 'Builder',
        date: new Date(Date.now() - 3_600_000).toISOString(),
      },
      {
        sha: 'def5678901234567890abcdef5678901234567890',
        shortSha: 'def5678',
        message: 'fix: resolve type error in cleanup-machine-agent',
        author: 'Builder',
        date: new Date(Date.now() - 7_200_000).toISOString(),
      },
    ],
    hasMoreCommits: true,
    updatedAt: Date.now(),
  };
}
