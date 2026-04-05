/**
 * Convex adapter for chatroom membership authorization.
 *
 * Wires the pure `checkChatroomMembershipForMachine` to the Convex database,
 * providing a one-liner for Convex query/mutation handlers.
 */

import type { QueryCtx, MutationCtx } from '../_generated/server';
import type { Id } from '../_generated/dataModel';
import {
  checkChatroomMembershipForMachine,
  type CheckChatroomMembershipDeps,
} from '../../src/domain/usecase/auth/extensions/chatroom-membership';

/**
 * Create Convex-backed dependencies for chatroom membership checks.
 */
function createConvexDeps(ctx: QueryCtx | MutationCtx): CheckChatroomMembershipDeps {
  return {
    getWorkspacesForMachine: async (machineId: string) => {
      const workspaces = await ctx.db
        .query('chatroom_workspaces')
        .withIndex('by_machine', (q: any) => q.eq('machineId', machineId))
        .collect();
      return workspaces
        .filter((w) => !w.removedAt) // Exclude soft-deleted workspaces
        .map((w) => ({
          chatroomId: w.chatroomId as string,
          machineId: w.machineId,
        }));
    },
    getChatroom: async (chatroomId: string) => {
      const chatroom = await ctx.db.get(chatroomId as Id<'chatroom_rooms'>);
      if (!chatroom) return null;
      return {
        _id: chatroom._id as string,
        ownerId: chatroom.ownerId as string,
      };
    },
  };
}

/**
 * Verify a user has chatroom-level access to a machine.
 *
 * Use this in any Convex function that accepts `machineId` and needs
 * to verify the caller has access through chatroom membership.
 *
 * @throws Error if user does not have access
 *
 * @example
 * ```ts
 * export const myQuery = query({
 *   args: { ...SessionIdArg, machineId: v.string() },
 *   handler: async (ctx, args) => {
 *     const session = await validateSession(ctx, args.sessionId);
 *     if (!session.valid) return null;
 *     await requireChatroomMachineAccess(ctx, args.machineId, session.userId);
 *     // ... proceed with authorized access
 *   },
 * });
 * ```
 */
export async function requireChatroomMachineAccess(
  ctx: QueryCtx | MutationCtx,
  machineId: string,
  userId: Id<'users'>
): Promise<void> {
  const deps = createConvexDeps(ctx);
  const result = await checkChatroomMembershipForMachine(deps, machineId, userId as string);
  if (!result.ok) {
    throw new Error(`Access denied: ${result.reason}`);
  }
}

/**
 * Check (without throwing) if a user has chatroom-level access to a machine.
 * Returns the result so callers can decide how to handle unauthorized access.
 */
export async function checkChatroomMachineAccess(
  ctx: QueryCtx | MutationCtx,
  machineId: string,
  userId: Id<'users'>
): Promise<{ ok: true; chatroomId: string } | { ok: false; reason: string }> {
  const deps = createConvexDeps(ctx);
  const result = await checkChatroomMembershipForMachine(deps, machineId, userId as string);
  if (result.ok) {
    return { ok: true, chatroomId: result.chatroomId };
  }
  return { ok: false, reason: result.reason };
}
