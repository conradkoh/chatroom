/**
 * Machine Access — pure functions for machine ownership verification.
 *
 * Extracted from duplicated helpers in commands.ts and workspaceFiles.ts.
 * Uses dependency injection for database access.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

/** Database access for machine lookups. */
export interface CheckMachineOwnershipDeps {
  getMachineByMachineId: (machineId: string) => Promise<{ userId: string } | null>;
}

/** Successful machine ownership check result. */
export interface MachineOwnershipSuccess {
  ok: true;
  machineId: string;
  userId: string;
}

/** Failed machine ownership check result. */
export interface MachineOwnershipFailure {
  ok: false;
  reason: string;
}

/** Result of checking machine ownership. */
export type MachineOwnershipResult = MachineOwnershipSuccess | MachineOwnershipFailure;

// ─── Core Logic ─────────────────────────────────────────────────────────────

/**
 * Check that a user is the owner of a machine.
 *
 * @param deps - Database access
 * @param machineId - Machine to check
 * @param userId - User to verify ownership for
 * @returns Check result indicating ownership status
 */
export async function checkMachineOwnership(
  deps: CheckMachineOwnershipDeps,
  machineId: string,
  userId: string
): Promise<MachineOwnershipResult> {
  const machine = await deps.getMachineByMachineId(machineId);

  if (!machine) {
    return { ok: false, reason: 'Machine not found' };
  }

  if (machine.userId !== userId) {
    return { ok: false, reason: 'Access denied: You do not own this machine' };
  }

  return { ok: true, machineId, userId };
}
