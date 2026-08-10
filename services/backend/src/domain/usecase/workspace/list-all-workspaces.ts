/**
 * Use Case: List All Workspaces for User
 *
 * Returns all active (non-removed) workspaces across every chatroom owned by a
 * user, plus the user's own unassigned (chatroom-free) workspaces, enriched
 * with machine alias.
 * Used by the frontend home page "Workspaces" tab.
 */

import type { Id } from '../../../../convex/_generated/dataModel';
import type { QueryCtx } from '../../../../convex/_generated/server';
import { isActiveWorkspace } from '../../entities/workspace';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ListAllWorkspacesInput {
  userId: Id<'users'>;
}

export interface WorkspaceForUserView {
  _id: Id<'chatroom_workspaces'>;
  chatroomId?: Id<'chatroom_rooms'>;
  machineId: string;
  workingDir: string;
  hostname: string;
  machineAlias?: string;
  registeredAt: number;
  registeredBy: string;
}

export type ListAllWorkspacesResult = WorkspaceForUserView[];

interface WorkspaceRow {
  _id: Id<'chatroom_workspaces'>;
  chatroomId?: Id<'chatroom_rooms'>;
  machineId: string;
  workingDir: string;
  hostname: string;
  registeredAt: number;
  registeredBy: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toWorkspaceRow(ws: {
  _id: Id<'chatroom_workspaces'>;
  chatroomId?: Id<'chatroom_rooms'>;
  machineId: string;
  workingDir: string;
  hostname: string;
  registeredAt: number;
  registeredBy: string;
}): WorkspaceRow {
  return { ...ws };
}

async function resolveMachineAliases(
  ctx: QueryCtx,
  machineIds: Set<string>
): Promise<Map<string, string | undefined>> {
  const machineAliasMap = new Map<string, string | undefined>();
  for (const machineId of machineIds) {
    const machine = await ctx.db
      .query('chatroom_machines')
      .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
      .first();
    if (machine?.alias) machineAliasMap.set(machineId, machine.alias);
  }
  return machineAliasMap;
}

// ─── Use Case ────────────────────────────────────────────────────────────────

// Unions chatroom-bound and unassigned rows with active filtering; kept as one
// pass so alias resolution and sorting cover the combined set.
// fallow-ignore-next-line complexity
export async function listAllWorkspaces(
  ctx: QueryCtx,
  input: ListAllWorkspacesInput
): Promise<ListAllWorkspacesResult> {
  const chatrooms = await ctx.db
    .query('chatroom_rooms')
    .withIndex('by_ownerId', (q) => q.eq('ownerId', input.userId))
    .collect();

  const rows: WorkspaceRow[] = [];
  const machineIds = new Set<string>();

  for (const chatroom of chatrooms) {
    const workspaces = await ctx.db
      .query('chatroom_workspaces')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroom._id))
      .collect();

    for (const ws of workspaces) {
      if (!isActiveWorkspace(ws.removedAt)) continue;
      rows.push(toWorkspaceRow(ws));
      machineIds.add(ws.machineId);
    }
  }

  // Union the user's own unassigned (chatroom-free) workspaces. Rows that carry
  // both fields are skipped so a future attach operation can never double-list.
  const unassigned = await ctx.db
    .query('chatroom_workspaces')
    .withIndex('by_userId', (q) => q.eq('userId', input.userId))
    .collect();

  for (const ws of unassigned) {
    if (!isActiveWorkspace(ws.removedAt)) continue;
    if (ws.chatroomId !== undefined) continue;
    rows.push(toWorkspaceRow(ws));
    machineIds.add(ws.machineId);
  }

  // Batch-resolve machine aliases (mirrors list-workspaces-for-chatroom.ts).
  const machineAliasMap = await resolveMachineAliases(ctx, machineIds);

  return rows
    .map((r) => ({ ...r, machineAlias: machineAliasMap.get(r.machineId) }))
    .sort((a, b) => b.registeredAt - a.registeredAt);
}
