/**
 * Use Case: List Registered Working Directories for Machine
 *
 * Returns the distinct working directories of a machine's active workspaces, sorted ascending.
 * It reads only `chatroom_workspaces`, applies no time cutoff, and never reads observations, so
 * the result depends only on registration state. The daemon uses it as its membership source.
 */

import type { QueryCtx } from '../../../../convex/_generated/server';
import { isActiveWorkspace } from '../../entities/workspace';

export interface ListRegisteredWorkingDirsForMachineInput {
  machineId: string;
}

/**
 * Distinct workingDirs of the machine's active workspaces, sorted ascending by code unit.
 *
 * Two chatrooms that share a workingDir produce one entry. Removed rows are excluded.
 */
export async function listRegisteredWorkingDirsForMachine(
  ctx: QueryCtx,
  input: ListRegisteredWorkingDirsForMachineInput
): Promise<string[]> {
  const workspaces = await ctx.db
    .query('chatroom_workspaces')
    .withIndex('by_machine', (q) => q.eq('machineId', input.machineId))
    .collect();

  const workingDirs = new Set(
    workspaces.filter((ws) => isActiveWorkspace(ws.removedAt)).map((ws) => ws.workingDir)
  );
  return [...workingDirs].sort();
}
