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

  return workspaces
    .filter((ws) => isActiveWorkspace(ws.removedAt))
    .map((ws) => ({
      _id: ws._id,
      machineId: ws.machineId,
      workingDir: ws.workingDir,
      hostname: ws.hostname,
      registeredAt: ws.registeredAt,
      registeredBy: ws.registeredBy,
    }));
}
