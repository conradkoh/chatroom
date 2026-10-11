/**
 * Use Case: List Workspace Activity for Machine
 *
 * Returns each active workspace directory on a machine with the last time any of
 * its chatrooms was observed. Unlike the recently-observed list, this applies no
 * time cutoff, so the result depends only on stored data, never on the current
 * time. The daemon can diff successive results to decide what to keep syncing.
 */

import type { Doc, Id } from '../../../../convex/_generated/dataModel';
import type { QueryCtx } from '../../../../convex/_generated/server';
import { isActiveWorkspace } from '../../entities/workspace';

export interface ActiveWorkspaceWithObservation {
  workspace: Doc<'chatroom_workspaces'>;
  /** Last observation of the workspace's chatroom, or null when never observed. */
  lastObservedAt: number | null;
}

export interface WorkspaceActivity {
  workingDir: string;
  /** Latest observation across all chatrooms sharing this workingDir; null when never observed. */
  lastObservedAt: number | null;
}

export interface ListWorkspaceActivityForMachineInput {
  machineId: string;
}

/**
 * Loads the machine's active workspaces, each paired with its chatroom's last observation.
 *
 * Observations are read by point lookup on `by_chatroomId`, once per distinct chatroom,
 * so the read set is bounded by the number of chatrooms on this machine.
 */
export async function loadActiveWorkspacesWithObservation(
  ctx: QueryCtx,
  machineId: string
): Promise<ActiveWorkspaceWithObservation[]> {
  const workspaces = await ctx.db
    .query('chatroom_workspaces')
    .withIndex('by_machine', (q) => q.eq('machineId', machineId))
    .collect();

  const activeWorkspaces = workspaces.filter((ws) => isActiveWorkspace(ws.removedAt));
  if (activeWorkspaces.length === 0) return [];

  const chatroomIds = [...new Set(activeWorkspaces.map((ws) => ws.chatroomId))];
  const lastObservedByChatroom = new Map<Id<'chatroom_rooms'>, number | null>();
  await Promise.all(
    chatroomIds.map(async (chatroomId) => {
      const observation = await ctx.db
        .query('chatroom_observation')
        .withIndex('by_chatroomId', (q) => q.eq('chatroomId', chatroomId))
        .first();
      lastObservedByChatroom.set(chatroomId, observation?.lastObservedAt ?? null);
    })
  );

  return activeWorkspaces.map((workspace) => ({
    workspace,
    lastObservedAt: lastObservedByChatroom.get(workspace.chatroomId) ?? null,
  }));
}

/** Later of two observation times; null (never observed) loses to any timestamp. */
function latestObservedAt(a: number | null | undefined, b: number | null): number | null {
  if (a === undefined || a === null) return b;
  if (b === null) return a;
  return Math.max(a, b);
}

export async function listWorkspaceActivityForMachine(
  ctx: QueryCtx,
  input: ListWorkspaceActivityForMachineInput
): Promise<WorkspaceActivity[]> {
  const rows = await loadActiveWorkspacesWithObservation(ctx, input.machineId);

  const latestByWorkingDir = new Map<string, number | null>();
  for (const { workspace, lastObservedAt } of rows) {
    latestByWorkingDir.set(
      workspace.workingDir,
      latestObservedAt(latestByWorkingDir.get(workspace.workingDir), lastObservedAt)
    );
  }

  return [...latestByWorkingDir.entries()]
    .map(([workingDir, lastObservedAt]): WorkspaceActivity => ({ workingDir, lastObservedAt }))
    .sort((a, b) => (a.workingDir < b.workingDir ? -1 : a.workingDir > b.workingDir ? 1 : 0));
}
