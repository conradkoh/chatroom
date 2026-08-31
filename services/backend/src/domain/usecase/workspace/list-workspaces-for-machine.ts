/**
 * Use Case: List Workspaces for Machine
 *
 * Returns active workspaces on a machine whose chatroom is currently observed.
 * Used by the daemon to discover which chatrooms/workspaces it manages.
 */

import {
  listRecentlyObservedWorkspacesForMachine,
  type ListRecentlyObservedWorkspacesForMachineResult,
  type WorkspaceForMachineView,
} from './list-recently-observed-workspaces-for-machine';
import type { QueryCtx } from '../../../../convex/_generated/server';

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
  });
}
