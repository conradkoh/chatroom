/**
 * Machine Access — Convex adapter for machine ownership verification.
 *
 * Wires the pure verifyMachineOwnership function to the Convex database.
 * Provides a one-liner for Convex query/mutation handlers.
 */

import type { QueryCtx, MutationCtx } from '../_generated/server';
import type { Id } from '../_generated/dataModel';
import {
  verifyMachineOwnership as verifyMachineOwnershipCore,
  type MachineAccessDeps,
} from '../../src/domain/usecase/auth/machine-access';

/**
 * Create Convex-backed dependencies for machine ownership checks.
 */
function createConvexDeps(ctx: QueryCtx | MutationCtx): MachineAccessDeps {
  return {
    getMachineByMachineId: async (machineId: string) => {
      const machine = await ctx.db
        .query('chatroom_machines')
        .withIndex('by_machineId', (q: any) => q.eq('machineId', machineId))
        .first();
      if (!machine) return null;
      return { userId: machine.userId as string };
    },
  };
}

/**
 * Verify that the authenticated user owns the given machine.
 *
 * @param ctx - Convex query/mutation context
 * @param machineId - The machine to check
 * @param userId - The user to verify ownership for
 * @returns true if the user owns the machine
 */
export async function verifyMachineOwnership(
  ctx: QueryCtx | MutationCtx,
  machineId: string,
  userId: Id<'users'>
): Promise<boolean> {
  const deps = createConvexDeps(ctx);
  return verifyMachineOwnershipCore(deps, machineId, userId as string);
}
