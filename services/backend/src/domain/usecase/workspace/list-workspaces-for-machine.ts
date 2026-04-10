/**
 * Use Case: List Workspaces for Machine
 *
 * Returns all active (non-removed) workspaces registered to a given machine.
 * Used by the daemon to discover which chatrooms/workspaces it manages.
 */

import type { Id } from '../../../../convex/_generated/dataModel';
import type { QueryCtx } from '../../../../convex/_generated/server';
import { isActiveParticipant } from '../../entities/participant';
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
  hasActiveAgents: boolean;
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

  const activeWorkspaces = workspaces.filter((ws) => isActiveWorkspace(ws.removedAt));

  // For each workspace, check if the chatroom has active non-user agent participants
  const results: WorkspaceForMachineView[] = [];
  for (const ws of activeWorkspaces) {
    const participants = await ctx.db
      .query('chatroom_participants')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', ws.chatroomId))
      .collect();

    const hasActiveAgents = participants.some(
      (p) => p.role !== 'user' && isActiveParticipant(p)
    );

    results.push({
      _id: ws._id,
      chatroomId: ws.chatroomId,
      workingDir: ws.workingDir,
      hostname: ws.hostname,
      registeredAt: ws.registeredAt,
      registeredBy: ws.registeredBy,
      hasActiveAgents,
    });
  }

  return results;
}
