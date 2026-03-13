/**
 * Upsert Workspace Git State Use Case
 *
 * Persists the git state for a workspace (machineId + workingDir).
 * Called by the daemon on each heartbeat when the state has changed
 * (change-detected: only writes when branch/isDirty/diffStat hash differs).
 *
 * Phase 2: No-op stub. Phase 5+ will upsert into `chatroom_workspaceGitState`.
 */

import type { MutationCtx } from '../../../../convex/_generated/server';
import type { WorkspaceGitState } from '../../types/workspace-git';

export interface UpsertWorkspaceGitStateInput {
  machineId: string;
  workingDir: string;
  state: WorkspaceGitState;
}

/**
 * Persist the git state for a workspace.
 *
 * Upserts by `machineId + workingDir`. On subsequent calls with the same
 * state (same branch, isDirty, diffStat), callers are expected to skip
 * the mutation entirely using `DaemonContext.lastPushedGitState` for
 * change detection.
 */
export async function upsertWorkspaceGitState(
  _ctx: MutationCtx,
  _input: UpsertWorkspaceGitStateInput
): Promise<void> {
  // Phase 5+: upsert into chatroom_workspaceGitState table
}
