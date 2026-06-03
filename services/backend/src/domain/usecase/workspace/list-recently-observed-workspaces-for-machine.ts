/**
 * Observation-first workspace list for a machine.
 *
 * Uses `by_lastObservedAt` range query then intersects with machine workspaces,
 * avoiding N+1 observation lookups per chatroom.
 */

import { WORKSPACE_RECENCY_WINDOW_MS } from '../../../../config/reliability';
import type { Id } from '../../../../convex/_generated/dataModel';
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
  recencyWindowMs?: number;
}

export async function listRecentlyObservedWorkspacesForMachine(
  ctx: QueryCtx,
  input: ListRecentlyObservedWorkspacesForMachineInput
): Promise<ListRecentlyObservedWorkspacesForMachineResult> {
  const recencyWindowMs = input.recencyWindowMs ?? WORKSPACE_RECENCY_WINDOW_MS;
  const cutoff = Date.now() - recencyWindowMs;

  const workspaces = await ctx.db
    .query('chatroom_workspaces')
    .withIndex('by_machine', (q) => q.eq('machineId', input.machineId))
    .collect();

  const activeWorkspaces = workspaces.filter((ws) => isActiveWorkspace(ws.removedAt));
  if (activeWorkspaces.length === 0) return [];

  const activeObservations = await ctx.db
    .query('chatroom_observation')
    .withIndex('by_lastObservedAt', (q) => q.gte('lastObservedAt', cutoff))
    .collect();

  const recentlyObservedChatrooms = new Set(
    activeObservations.map((o) => o.chatroomId as Id<'chatroom_rooms'>)
  );

  return activeWorkspaces
    .filter((ws) => recentlyObservedChatrooms.has(ws.chatroomId))
    .map(
      (ws): WorkspaceForMachineView => ({
        _id: ws._id,
        chatroomId: ws.chatroomId,
        workingDir: ws.workingDir,
        hostname: ws.hostname,
        registeredAt: ws.registeredAt,
        registeredBy: ws.registeredBy,
      })
    );
}
