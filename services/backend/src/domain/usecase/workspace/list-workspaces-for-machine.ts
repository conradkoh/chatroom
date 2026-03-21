/**
 * Use Case: List Workspaces for Machine
 *
 * Returns all active (non-removed) workspaces registered to a given machine.
 * Used by the daemon to discover which chatrooms/workspaces it manages.
 */

import type { Id } from '../../../../convex/_generated/dataModel';
import type { QueryCtx } from '../../../../convex/_generated/server';
import { isActiveWorkspace } from '../../entities/workspace';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ListWorkspacesForMachineInput {
  machineId: string;
}

export interface WorkspaceForMachineView {
  _id: Id<'chatroom_workspaces'>;
  chatroomId: Id<'chatroom_rooms'>;
  workingDir: string;
  hostname: string;
  registeredAt: number;
  registeredBy: string;
}

export type ListWorkspacesForMachineResult = WorkspaceForMachineView[];

// ─── Use Case ────────────────────────────────────────────────────────────────

export async function listWorkspacesForMachine(
  ctx: QueryCtx,
  input: ListWorkspacesForMachineInput
): Promise<ListWorkspacesForMachineResult> {
  const workspaces = await ctx.db
    .query('chatroom_workspaces')
    .withIndex('by_machine', (q) => q.eq('machineId', input.machineId))
    .collect();

  return workspaces
    .filter((ws) => isActiveWorkspace(ws.removedAt))
    .map((ws) => ({
      _id: ws._id,
      chatroomId: ws.chatroomId,
      workingDir: ws.workingDir,
      hostname: ws.hostname,
      registeredAt: ws.registeredAt,
      registeredBy: ws.registeredBy,
    }));
}
