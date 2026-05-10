/**
 * Unified Access Check — Convex adapter.
 *
 * Wires the pure checkAccess/requireAccess functions to the Convex database.
 * Provides a one-liner for Convex query/mutation handlers.
 */

import {
  checkAccess as checkAccessCore,
  requireAccess as requireAccessCore,
  type CheckAccessDeps,
  type CheckAccessParams,
  type AccessResult,
  type Permission,
} from '../../src/domain/usecase/auth/extensions/check-access';
import type { Id } from '../_generated/dataModel';
import type { QueryCtx, MutationCtx } from '../_generated/server';
import { str } from '../utils/types';

/** Convert a Convex Id to a plain string for the pure-function layer. */

/**
 * Create Convex-backed dependencies for unified access checks.
 */
function createConvexDeps(ctx: QueryCtx | MutationCtx): CheckAccessDeps {
  return {
    getMachineByMachineId: async (machineId: string) => {
      const machine = await ctx.db
        .query('chatroom_machines')
        .withIndex('by_machineId', (q: any) => q.eq('machineId', machineId))
        .first();
      if (!machine) return null;
      return { userId: str(machine.userId) };
    },
    getChatroom: async (chatroomId: string) => {
      const chatroom = await ctx.db.get("chatroom_rooms", chatroomId as Id<'chatroom_rooms'>);
      if (!chatroom) return null;
      return {
        id: str(chatroom._id),
        ownerId: str(chatroom.ownerId),
      };
    },
    getWorkspacesForMachine: async (machineId: string) => {
      const workspaces = await ctx.db
        .query('chatroom_workspaces')
        .withIndex('by_machine', (q: any) => q.eq('machineId', machineId))
        .collect();
      return workspaces
        .filter((w) => !w.removedAt)
        .map((w) => ({
          chatroomId: str(w.chatroomId),
          machineId: w.machineId,
        }));
    },
  };
}

/**
 * Check if an accessor has the requested permission on a resource.
 *
 * @param ctx - Convex query/mutation context
 * @param params - Accessor, resource, and permission to check
 * @returns Access result indicating grant or denial
 */
export async function checkAccess(
  ctx: QueryCtx | MutationCtx,
  params: CheckAccessParams
): Promise<AccessResult> {
  const deps = createConvexDeps(ctx);
  return checkAccessCore(deps, params);
}

/**
 * Require that an accessor has the requested permission on a resource.
 * Throws a ConvexError if access is denied.
 *
 * @param ctx - Convex query/mutation context
 * @param params - Accessor, resource, and permission to check
 * @returns The granted permission
 * @throws ConvexError if access is denied
 */
export async function requireAccess(
  ctx: QueryCtx | MutationCtx,
  params: CheckAccessParams
): Promise<{ permission: Permission }> {
  const deps = createConvexDeps(ctx);
  return requireAccessCore(deps, params);
}
