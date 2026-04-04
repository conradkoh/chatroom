/**
 * Machine Access — pure functions for machine ownership verification.
 *
 * Extracted from duplicated helpers in commands.ts and workspaceFiles.ts.
 * Uses dependency injection for database access.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

/** Database access for machine lookups. */
export interface MachineAccessDeps {
  getMachineByMachineId: (machineId: string) => Promise<{ userId: string } | null>;
}

// ─── Core Logic ─────────────────────────────────────────────────────────────

/**
 * Verify that a user is the owner of a machine.
 *
 * @param deps - Database access
 * @param machineId - Machine to check
 * @param userId - User to verify ownership for
 * @returns true if the user owns the machine
 */
export async function verifyMachineOwnership(
  deps: MachineAccessDeps,
  machineId: string,
  userId: string
): Promise<boolean> {
  const machine = await deps.getMachineByMachineId(machineId);
  return !!machine && machine.userId === userId;
}
