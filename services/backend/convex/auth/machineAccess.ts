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
} from '../../src/domain/usecase/auth/extensions/machine-access';

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

/** Result type for machine ownership check. */
export type MachineOwnershipResult = { ok: true } | { ok: false; reason: string };

/**
 * Check that the authenticated user owns the given machine.
 *
 * @param ctx - Convex query/mutation context
 * @param machineId - The machine to check
 * @param userId - The user to verify ownership for
 * @returns { ok: true } if the user owns the machine, { ok: false, reason } otherwise
 */
export async function checkMachineOwnership(
  ctx: QueryCtx | MutationCtx,
  machineId: string,
  userId: Id<'users'>
): Promise<MachineOwnershipResult> {
  const deps = createConvexDeps(ctx);
  const owns = await verifyMachineOwnershipCore(deps, machineId, userId as string);
  if (owns) {
    return { ok: true };
  }
  return { ok: false, reason: 'User does not own this machine' };
}

/**
 * @deprecated Use {@link checkMachineOwnership} instead. This function returns a plain boolean.
 *
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
