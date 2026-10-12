/**
 * Observation-first workspace list for a machine.
 *
 * Looks up observations only for the chatrooms this machine actually has
 * workspaces in (point lookups on `by_chatroomId`), instead of scanning the
 * global `by_lastObservedAt` range across every chatroom and intersecting.
 * Each machine typically spans only a handful of chatrooms, so this reads a
 * tiny, bounded set of observation rows rather than the entire recently-active
 * observation set on every call.
 */

import { OBSERVATION_TTL_MS } from '../../../../config/reliability';
import type { Doc, Id } from '../../../../convex/_generated/dataModel';
import type { QueryCtx } from '../../../../convex/_generated/server';
import { isActiveWorkspace } from '../../entities/workspace';

export interface WorkspaceForMachineView {
  _id: Id<'chatroom_workspaces'>;
  chatroomId: Id<'chatroom_rooms'>;
  workingDir: string;
  hostname: string;
  registeredAt: number;
  registeredBy: string;
}

export type ListRecentlyObservedWorkspacesForMachineResult = WorkspaceForMachineView[];

export interface ListRecentlyObservedWorkspacesForMachineInput {
  machineId: string;
}

interface ActiveWorkspaceWithObservation {
  workspace: Doc<'chatroom_workspaces'>;
  /** Last observation of the workspace's chatroom, or null when never observed. */
  lastObservedAt: number | null;
}

/**
 * Loads the machine's active workspaces, each paired with its chatroom's last observation.
 *
 * Observations are read by point lookup on `by_chatroomId`, once per distinct chatroom,
 * so the read set is bounded by the number of chatrooms on this machine.
 */
async function loadActiveWorkspacesWithObservation(
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

export async function listRecentlyObservedWorkspacesForMachine(
  ctx: QueryCtx,
  input: ListRecentlyObservedWorkspacesForMachineInput
): Promise<ListRecentlyObservedWorkspacesForMachineResult> {
  const cutoff = Date.now() - OBSERVATION_TTL_MS;

  const rows = await loadActiveWorkspacesWithObservation(ctx, input.machineId);

  return rows
    .filter(({ lastObservedAt }) => lastObservedAt !== null && lastObservedAt > cutoff)
    .map(({ workspace: ws }): WorkspaceForMachineView => ({
      _id: ws._id,
      chatroomId: ws.chatroomId,
      workingDir: ws.workingDir,
      hostname: ws.hostname,
      registeredAt: ws.registeredAt,
      registeredBy: ws.registeredBy,
    }));
}
