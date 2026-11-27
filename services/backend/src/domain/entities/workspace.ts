/**
 * Domain Model: Workspace
 *
 * Represents a registered workspace — a machine + working directory pair
 * where agents operate. Persists independently of agent configs.
 *
 * A workspace is uniquely identified by the triple:
 *   (chatroomId, machineId, workingDir)
 *
 * The data model allows several workspaces per chatroom. How many may be ACTIVE
 * at once is policy, not schema, and is enforced at the mutation boundary
 * (`workspaces.registerWorkspace` plus the switch use case's replacement
 * semantics) — the register/import use case stays uncapped.
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

/** A machine + normalized folder pair. */
export interface WorkspaceLocation {
  machineId: string;
  workingDir: string;
}

// ─── Policy ──────────────────────────────────────────────────────────────────

/**
 * Maximum number of ACTIVE workspaces (removedAt undefined) a chatroom may hold.
 * Policy, not schema: raising it needs no schema, index or data change. Enforced in
 * `workspaces.registerWorkspace` only; the registerWorkspace use case is deliberately uncapped.
 */
export const MAX_ACTIVE_WORKSPACES_PER_CHATROOM = 1;

/**
 * True when `target` may be registered for a chatroom whose active workspaces are `activeWorkspaces`:
 * either the same triple is already active (idempotent re-register) or the active count is below `cap`.
 * Callers pass only ACTIVE rows (removedAt undefined) and a `target.workingDir` already normalized.
 */
export function canRegisterWorkspace(input: {
  activeWorkspaces: readonly WorkspaceLocation[];
  target: WorkspaceLocation;
  cap?: number;
}): boolean {
  const cap = input.cap ?? MAX_ACTIVE_WORKSPACES_PER_CHATROOM;
  const alreadyActive = input.activeWorkspaces.some(
    (ws) => ws.machineId === input.target.machineId && ws.workingDir === input.target.workingDir
  );
  return alreadyActive || input.activeWorkspaces.length < cap;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Check if a workspace is active (not soft-deleted). */
export function isActiveWorkspace(removedAt: number | undefined): boolean {
  return removedAt === undefined;
}
