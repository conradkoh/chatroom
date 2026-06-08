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

  // Resolve recency by reading the observation for each of this machine's
  // chatrooms directly (one singleton row per chatroom via `by_chatroomId`),
  // rather than collecting every recently-observed chatroom globally.
  const chatroomIds = [...new Set(activeWorkspaces.map((ws) => ws.chatroomId))];
  const recentlyObservedChatrooms = new Set<Id<'chatroom_rooms'>>();
  await Promise.all(
    chatroomIds.map(async (chatroomId) => {
      const observation = await ctx.db
        .query('chatroom_observation')
        .withIndex('by_chatroomId', (q) => q.eq('chatroomId', chatroomId))
        .first();
      if (observation && observation.lastObservedAt >= cutoff) {
        recentlyObservedChatrooms.add(chatroomId);
      }
    })
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
