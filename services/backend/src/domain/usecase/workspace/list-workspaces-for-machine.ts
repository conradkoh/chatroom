/**
 * Use Case: List Workspaces for Machine
 *
 * Returns active (non-removed) workspaces registered to a given machine,
 * filtered to only those whose chatroom has been observed in the last 7 days.
 * Used by the daemon to discover which chatrooms/workspaces it manages.
 */

import type { Id } from '../../../../convex/_generated/dataModel';
import type { QueryCtx } from '../../../../convex/_generated/server';
import { isActiveWorkspace } from '../../entities/workspace';

// ─── Constants ──────────────────────────────────────────────────────────────

/** Workspaces are considered active only if their chatroom was observed within this window. */
const WORKSPACE_RECENCY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

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

  const activeWorkspaces = workspaces.filter((ws) => isActiveWorkspace(ws.removedAt));

  if (activeWorkspaces.length === 0) return [];

  // Filter to only workspaces whose chatroom has been observed recently
  const cutoff = Date.now() - WORKSPACE_RECENCY_WINDOW_MS;
  const uniqueChatroomIds = Array.from(
    new Set(activeWorkspaces.map((ws) => ws.chatroomId))
  );

  const observations = await Promise.all(
    uniqueChatroomIds.map((chatroomId) =>
      ctx.db
        .query('chatroom_observation')
        .withIndex('by_chatroomId', (q) => q.eq('chatroomId', chatroomId))
        .first()
    )
  );

  const recentlyObservedChatrooms = new Set(
    observations
      .filter((o): o is NonNullable<typeof o> => o !== null && o.lastObservedAt >= cutoff)
      .map((o) => o.chatroomId)
  );

  return activeWorkspaces
    .filter((ws) => recentlyObservedChatrooms.has(ws.chatroomId))
    .map((ws) => ({
      _id: ws._id,
      chatroomId: ws.chatroomId,
      workingDir: ws.workingDir,
      hostname: ws.hostname,
      registeredAt: ws.registeredAt,
      registeredBy: ws.registeredBy,
    }));
}
