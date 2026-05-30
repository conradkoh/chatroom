/**
 * Machine-scoped authentication and authorization helpers.
 *
 * ## Auth layers (apply in order)
 *
 * 1. **Session** — `requireSession` / `getSession` validates `sessionId`.
 * 2. **Machine permission** — `checkAccess` on `{ type: 'machine', id: machineId }` with
 *    `owner`, `write-access`, or `read-access` as appropriate for the endpoint.
 * 3. **Resource id** — handlers must scope DB reads/writes to the authorized `machineId`
 *    (or verify nested resources belong to that machine). Never use a client-supplied id
 *    without tying it to the machine checked in layer 2.
 *
 * Daemon and webapp endpoints that accept `machineId` should use these helpers instead of
 * session-only checks.
 */

import { ConvexError } from 'convex/values';

import type { MutationCtx, QueryCtx } from '../_generated/server';
import { checkAccess } from './accessCheck';
import { type SessionAuth, getSession, requireSession } from './session';

/** Auth result for machine-scoped operations. */
export type MachineAuth = SessionAuth;

type MachinePermission = 'owner' | 'write-access' | 'read-access';

async function requireMachinePermission(
  ctx: QueryCtx | MutationCtx,
  auth: SessionAuth,
  machineId: string,
  permission: MachinePermission
): Promise<void> {
  const access = await checkAccess(ctx, {
    accessor: { type: 'user', id: auth.userId },
    resource: { type: 'machine', id: machineId },
    permission,
  });
  if (!access.ok) {
    throw new ConvexError({
      code: 'NOT_AUTHORIZED_MACHINE',
      message: 'Not authorized for this machine',
    });
  }
}

/** Session + machine `owner` permission. Use for daemon mutations and owner-only queries. */
export async function requireMachineOwner(
  ctx: QueryCtx | MutationCtx,
  sessionId: string,
  machineId: string
): Promise<MachineAuth> {
  const auth = await requireSession(ctx, sessionId);
  await requireMachinePermission(ctx, auth, machineId, 'owner');
  return auth;
}

/** Session + machine `write-access` permission. Use for run/stop and similar control plane. */
export async function requireMachineWriteAccess(
  ctx: QueryCtx | MutationCtx,
  sessionId: string,
  machineId: string
): Promise<MachineAuth> {
  const auth = await requireSession(ctx, sessionId);
  await requireMachinePermission(ctx, auth, machineId, 'write-access');
  return auth;
}

/**
 * Fail-open machine owner check for queries that should return null/empty when unauthorized.
 * Returns `null` if the session is invalid or the user lacks owner access on the machine.
 */
export async function getMachineOwner(
  ctx: QueryCtx | MutationCtx,
  sessionId: string,
  machineId: string
): Promise<MachineAuth | null> {
  const auth = await getSession(ctx, sessionId);
  if (!auth) return null;

  const access = await checkAccess(ctx, {
    accessor: { type: 'user', id: auth.userId },
    resource: { type: 'machine', id: machineId },
    permission: 'owner',
  });
  if (!access.ok) return null;

  return auth;
}
