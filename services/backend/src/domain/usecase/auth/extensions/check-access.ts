/**
 * Unified Access Check — pure functions for permission-based access control.
 *
 * Provides a single entry point (`checkAccess` / `requireAccess`) that handles
 * all resource types (machine, chatroom) and permission levels (owner, write-access,
 * read-access). Uses dependency injection for database access.
 */

import { ConvexError } from 'convex/values';

// ─── Types ──────────────────────────────────────────────────────────────────

/** Permission levels, from most to least restrictive. */
export type Permission = 'owner' | 'write-access' | 'read-access';

/** An entity requesting access. */
export type Accessor = { type: 'user'; id: string };

/** A resource being accessed. */
export type Resource = { type: 'machine'; id: string } | { type: 'chatroom'; id: string };

/** Parameters for an access check. */
export interface CheckAccessParams {
  accessor: Accessor;
  resource: Resource;
  permission: Permission;
}

/** Successful access check result. */
export interface AccessGranted {
  ok: true;
  permission: Permission;
}

/** Failed access check result. */
export interface AccessDenied {
  ok: false;
  reason: string;
}

/** Result of an access check. */
export type AccessResult = AccessGranted | AccessDenied;

/** A workspace registration on a machine, used to resolve machine write-access. */
export type MachineWorkspaceRef = { chatroomId: string; machineId: string };

/** Database access for unified access checks. */
export interface CheckAccessDeps {
  getMachineByMachineId: (id: string) => Promise<{ userId: string } | null>;
  getChatroom: (id: string) => Promise<{ id: string; ownerId: string } | null>;
  /**
   * Active workspaces registered on the machine. Streamed so callers can stop at the first match.
   * Adapters must skip removed workspaces.
   */
  getWorkspacesForMachine: (
    machineId: string
  ) => Iterable<MachineWorkspaceRef> | AsyncIterable<MachineWorkspaceRef>;
}

// ─── Core Logic ─────────────────────────────────────────────────────────────

/**
 * Check if an accessor has the requested permission on a resource.
 *
 * @param deps - Injected data access functions
 * @param params - Accessor, resource, and permission to check
 * @returns Access result indicating grant or denial
 */
export async function checkAccess(
  deps: CheckAccessDeps,
  params: CheckAccessParams
): Promise<AccessResult> {
  const { accessor, resource, permission } = params;

  if (resource.type === 'machine') {
    return checkMachineAccess(deps, accessor, resource.id, permission);
  }

  if (resource.type === 'chatroom') {
    return checkChatroomAccess(deps, accessor, resource.id, permission);
  }

  // Exhaustive check — TypeScript will error if a resource type is unhandled
  const _exhaustive: never = resource;
  void _exhaustive;
  return { ok: false, reason: `Unknown resource type` };
}

/**
 * Require that an accessor has the requested permission on a resource.
 * Throws a ConvexError if access is denied.
 *
 * @param deps - Injected data access functions
 * @param params - Accessor, resource, and permission to check
 * @returns The granted permission
 * @throws ConvexError if access is denied
 */
export async function requireAccess(
  deps: CheckAccessDeps,
  params: CheckAccessParams
): Promise<{ permission: Permission }> {
  const result = await checkAccess(deps, params);

  if (!result.ok) {
    throw new ConvexError(result.reason);
  }

  return { permission: result.permission };
}

// ─── Machine Access ─────────────────────────────────────────────────────────

async function checkMachineAccess(
  deps: CheckAccessDeps,
  accessor: Accessor,
  machineId: string,
  permission: Permission
): Promise<AccessResult> {
  if (permission === 'owner') {
    return checkMachineOwner(deps, accessor, machineId);
  }

  // write-access and read-access: owner always has access
  const ownerResult = await checkMachineOwner(deps, accessor, machineId);
  if (ownerResult.ok) {
    return { ok: true, permission };
  }

  // Also check via chatroom membership
  return checkMachineWriteAccess(deps, accessor, machineId);
}

async function checkMachineOwner(
  deps: CheckAccessDeps,
  accessor: Accessor,
  machineId: string
): Promise<AccessResult> {
  const machine = await deps.getMachineByMachineId(machineId);

  if (!machine) {
    return { ok: false, reason: 'Machine not found' };
  }

  if (machine.userId !== accessor.id) {
    return { ok: false, reason: 'Access denied: You do not own this machine' };
  }

  return { ok: true, permission: 'owner' };
}

/**
 * Non-owner machine access: grants `write-access` when the accessor owns any chatroom the machine
 * has an active workspace in.
 *
 * Streams the machine's workspaces and returns at the first accessor-owned chatroom, reading each
 * distinct chatroom at most once. A denial necessarily scans every workspace; success reads only
 * the prefix up to the first owned chatroom.
 */
async function checkMachineWriteAccess(
  deps: CheckAccessDeps,
  accessor: Accessor,
  machineId: string
): Promise<AccessResult> {
  let sawWorkspace = false;
  const visited = new Set<string>();

  for await (const { chatroomId } of deps.getWorkspacesForMachine(machineId)) {
    sawWorkspace = true;
    if (visited.has(chatroomId)) continue;
    visited.add(chatroomId);

    const chatroom = await deps.getChatroom(chatroomId);
    if (chatroom?.ownerId === accessor.id) {
      return { ok: true, permission: 'write-access' };
    }
  }

  return sawWorkspace
    ? { ok: false, reason: 'User does not have access to any chatroom with this machine' }
    : { ok: false, reason: 'Machine has no workspace registrations' };
}

// ─── Chatroom Access ────────────────────────────────────────────────────────

async function checkChatroomAccess(
  deps: CheckAccessDeps,
  accessor: Accessor,
  chatroomId: string,
  permission: Permission
): Promise<AccessResult> {
  const chatroom = await deps.getChatroom(chatroomId);

  if (!chatroom) {
    return { ok: false, reason: 'Chatroom not found' };
  }

  // All permission levels currently resolve to owner check
  if (chatroom.ownerId !== accessor.id) {
    return { ok: false, reason: 'Access denied: You do not own this chatroom' };
  }

  return { ok: true, permission };
}
