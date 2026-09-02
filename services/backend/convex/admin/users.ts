import { ConvexError, v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import {
  requireAuthenticatedPermission,
  SYSTEM_ADMIN_ACCESS_PERMISSION,
} from '../../application/auth';
import { hasPermission } from '../../application/auth/resolve';
import { getAuthUser } from '../../modules/auth/session';
import type { Doc, Id } from '../_generated/dataModel';
import { mutation, query, type MutationCtx } from '../_generated/server';

/**
 * User Role Management
 *
 * All functions are guarded by permission keys (not role-name checks):
 * - `listUsers`       requires `users:list`
 * - `updateUserRoles` requires `users:write`
 * - Managing system_admin users additionally requires `system_admin:access`
 *
 * Business admins hold `users:list`/`users:write` via the admin role.
 * System admins hold all permissions including `system_admin:access`.
 */

const USERS_LIST = 'users:list' as const;
const USERS_WRITE = 'users:write' as const;

/** Effective role preset — maps to built-in starter roles */
export type EffectiveRole = 'standard_user' | 'admin' | 'system_admin';

export interface UserSummary {
  _id: Id<'users'>;
  name: string;
  email?: string | undefined;
  type: 'full' | 'anonymous';
  accessLevel: 'user' | 'system_admin';
  roleNames: string[];
  effectiveRole: EffectiveRole;
}

function toEffectiveRole(user: {
  accessLevel?: 'user' | 'system_admin' | undefined;
  roleNames?: string[] | undefined;
}): EffectiveRole {
  if (user.accessLevel === 'system_admin') return 'system_admin';
  if (user.roleNames?.includes('admin')) return 'admin';
  return 'standard_user';
}

function presetToStorage(effectiveRole: EffectiveRole): {
  accessLevel: 'user' | 'system_admin';
  roleNames?: string[] | undefined;
} {
  switch (effectiveRole) {
    case 'system_admin':
      return { accessLevel: 'system_admin', roleNames: undefined };
    case 'admin':
      return { accessLevel: 'user', roleNames: ['admin'] };
    case 'standard_user':
      return { accessLevel: 'user', roleNames: ['user'] };
  }
}

/**
 * Last-admin guard: blocks demoting the sole system administrator.
 * Passing a non-demotion preset is a no-op.
 */
async function assertNotLastSystemAdmin(
  ctx: MutationCtx,
  target: Doc<'users'>,
  effectiveRole: EffectiveRole
): Promise<void> {
  if (target.accessLevel !== 'system_admin' || effectiveRole === 'system_admin') {
    return;
  }
  const adminCount = (await ctx.db.query('users').collect()).filter(
    (u) => u.accessLevel === 'system_admin'
  ).length;
  if (adminCount <= 1) {
    throw new ConvexError({
      code: 'FORBIDDEN',
      message: 'Cannot remove the last system administrator',
    });
  }
}

/**
 * Lists all users (including anonymous) with their effective role.
 * Permission: `users:list` — granted to admin and system_admin roles.
 */
export const listUsers = query({
  args: { ...SessionIdArg },
  handler: async (ctx, args): Promise<UserSummary[]> => {
    const actor = await getAuthUser(ctx, args);
    requireAuthenticatedPermission(actor, USERS_LIST, {
      unauthorizedMessage: 'You must be logged in to list users',
    });

    const users = await ctx.db.query('users').collect();
    const actorCanManageSystemAdmins = hasPermission(actor, SYSTEM_ADMIN_ACCESS_PERMISSION);

    return users
      .filter((user) => actorCanManageSystemAdmins || user.accessLevel !== 'system_admin')
      .map((user) => ({
        _id: user._id,
        name: user.name,
        email: user.type === 'full' ? user.email : undefined,
        type: user.type,
        accessLevel: user.accessLevel ?? 'user',
        roleNames: user.roleNames ?? [],
        effectiveRole: toEffectiveRole(user),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  },
});

/**
 * Assigns an effective role preset to a user.
 * Permission: `users:write` — system admins hold this.
 */
export const updateUserRoles = mutation({
  args: {
    userId: v.id('users'),
    effectiveRole: v.union(
      v.literal('standard_user'),
      v.literal('admin'),
      v.literal('system_admin')
    ),
    ...SessionIdArg,
  },
  // fallow-ignore-next-line complexity
  handler: async (ctx, args) => {
    const actor = await getAuthUser(ctx, args);
    requireAuthenticatedPermission(actor, USERS_WRITE, {
      unauthorizedMessage: 'You must be logged in to update user roles',
    });

    const target = await ctx.db.get('users', args.userId);
    if (!target) {
      throw new ConvexError({ code: 'NOT_FOUND', message: 'User not found' });
    }

    const actorCanManageSystemAdmins = hasPermission(actor, SYSTEM_ADMIN_ACCESS_PERMISSION);
    if (!actorCanManageSystemAdmins) {
      if (args.effectiveRole === 'system_admin' || target.accessLevel === 'system_admin') {
        throw new ConvexError({
          code: 'FORBIDDEN',
          message: 'Only system administrators can manage the system administrator role',
        });
      }
    }

    await assertNotLastSystemAdmin(ctx, target, args.effectiveRole);
    // Clearing roleNames (undefined) on system_admin promotion matches the migrations unset pattern.
    await ctx.db.patch('users', args.userId, presetToStorage(args.effectiveRole));
  },
});
