/**
 * Use Case: List Workspaces for Machine
 *
 * Returns active workspaces on a machine whose chatroom was observed within 7 days.
 * Used by the daemon to discover which chatrooms/workspaces it manages.
 */

import { WORKSPACE_RECENCY_WINDOW_MS } from '../../../../config/reliability';
import type { QueryCtx } from '../../../../convex/_generated/server';

import {
  listRecentlyObservedWorkspacesForMachine,
  type ListRecentlyObservedWorkspacesForMachineResult,
  type WorkspaceForMachineView,
} from './list-recently-observed-workspaces-for-machine';

export type { WorkspaceForMachineView };

export interface ListWorkspacesForMachineInput {
  machineId: string;
}

export type ListWorkspacesForMachineResult = ListRecentlyObservedWorkspacesForMachineResult;

export async function listWorkspacesForMachine(
  ctx: QueryCtx,
  input: ListWorkspacesForMachineInput
): Promise<ListWorkspacesForMachineResult> {
  return listRecentlyObservedWorkspacesForMachine(ctx, {
    machineId: input.machineId,
    recencyWindowMs: WORKSPACE_RECENCY_WINDOW_MS,
  });
}
