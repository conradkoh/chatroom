/**
 * Use Case: List Workspaces for Chatroom
 *
 * Returns all active (non-removed) workspaces registered to a given chatroom.
 * Used by the frontend to display workspace information.
 */

import type { Id } from '../../../../convex/_generated/dataModel';
import type { QueryCtx } from '../../../../convex/_generated/server';
import { isActiveWorkspace } from '../../entities/workspace';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ListWorkspacesForChatroomInput {
  chatroomId: Id<'chatroom_rooms'>;
}

export interface WorkspaceForChatroomView {
  _id: Id<'chatroom_workspaces'>;
  machineId: string;
  workingDir: string;
  hostname: string;
  /** Machine alias set by the user (if any). Prefer displaying this over hostname. */
  machineAlias?: string;
  registeredAt: number;
  registeredBy: string;
}

export type ListWorkspacesForChatroomResult = WorkspaceForChatroomView[];

// ─── Use Case ────────────────────────────────────────────────────────────────

export async function listWorkspacesForChatroom(
  ctx: QueryCtx,
  input: ListWorkspacesForChatroomInput
): Promise<ListWorkspacesForChatroomResult> {
  const workspaces = await ctx.db
    .query('chatroom_workspaces')
    .withIndex('by_chatroom', (q) => q.eq('chatroomId', input.chatroomId))
    .collect();

  const activeWorkspaces = workspaces.filter((ws) => isActiveWorkspace(ws.removedAt));

  // Collect unique machineIds to batch-resolve aliases
  const machineIds = [...new Set(activeWorkspaces.map((ws) => ws.machineId))];
  const machineAliasMap = new Map<string, string | undefined>();

  for (const machineId of machineIds) {
    const machine = await ctx.db
      .query('chatroom_machines')
      .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
      .first();
    if (machine?.alias) {
      machineAliasMap.set(machineId, machine.alias);
    }
  }

  return activeWorkspaces.map((ws) => ({
    _id: ws._id,
    machineId: ws.machineId,
    workingDir: ws.workingDir,
    hostname: ws.hostname,
    machineAlias: machineAliasMap.get(ws.machineId),
    registeredAt: ws.registeredAt,
    registeredBy: ws.registeredBy,
  }));
}
