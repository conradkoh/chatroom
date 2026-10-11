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

import { loadActiveWorkspacesWithObservation } from './list-workspace-activity-for-machine';
import { OBSERVATION_TTL_MS } from '../../../../config/reliability';
import type { Id } from '../../../../convex/_generated/dataModel';
import type { QueryCtx } from '../../../../convex/_generated/server';

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
