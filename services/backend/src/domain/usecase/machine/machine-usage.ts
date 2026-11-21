/**
 * Owner-facing usage metrics for a machine.
 *
 * Shares the `by_machine_removedAt` index with the purge's workspace detach:
 * active workspaces are those with `removedAt` unset. The scan is capped so a
 * machine with an unbounded workspace history cannot make the Machines tab
 * subscription expensive; callers surface `capped` to the UI.
 */

import type { QueryCtx } from '../../../../convex/_generated/server';

/** Maximum active workspaces counted per machine (UI shows "500+"). */
export const MACHINE_USAGE_SCAN_CAP = 500;

export interface MachineUsage {
  activeWorkspaceCount: number;
  activeChatroomCount: number;
  capped: boolean;
}

/** Active = removedAt undefined. Counts workspaces and distinct chatroomIds. Reads at most CAP+1 rows. */
export async function getMachineUsage(
  ctx: Pick<QueryCtx, 'db'>,
  machineId: string
): Promise<MachineUsage> {
  const rows = await ctx.db
    .query('chatroom_workspaces')
    .withIndex('by_machine_removedAt', (q) =>
      q.eq('machineId', machineId).eq('removedAt', undefined)
    )
    .take(MACHINE_USAGE_SCAN_CAP + 1);

  const capped = rows.length > MACHINE_USAGE_SCAN_CAP;
  const counted = capped ? rows.slice(0, MACHINE_USAGE_SCAN_CAP) : rows;

  return {
    activeWorkspaceCount: counted.length,
    activeChatroomCount: new Set(counted.map((row) => row.chatroomId)).size,
    capped,
  };
}
