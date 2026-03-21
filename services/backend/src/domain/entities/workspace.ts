/**
 * Domain Model: Workspace
 *
 * Represents a registered workspace — a machine + working directory pair
 * where agents operate. Persists independently of agent configs.
 *
 * A workspace is uniquely identified by the triple:
 *   (chatroomId, machineId, workingDir)
 *
 * Workspaces support soft-delete via `removedAt`. When set, the workspace
 * is considered inactive and filtered out of active queries.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

/** Fields required to register a new workspace. */
export interface WorkspaceRegistration {
  chatroomId: string;
  machineId: string;
  workingDir: string;
  hostname: string;
  registeredBy: string;
}

/** Fields needed to identify a workspace uniquely. */
export interface WorkspaceIdentity {
  chatroomId: string;
  machineId: string;
  workingDir: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Check if a workspace is active (not soft-deleted). */
export function isActiveWorkspace(removedAt: number | undefined): boolean {
  return removedAt === undefined;
}
