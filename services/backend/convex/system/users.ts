import { ConvexError, v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { requireAuthenticatedPermission } from '../../application/auth';
import { getAuthUser } from '../../modules/auth/session';
import type { Doc, Id } from '../_generated/dataModel';
import { mutation, query, type MutationCtx } from '../_generated/server';

/**
 * System User Role Management
 *
 * All functions are guarded by permission keys (not role-name checks):
 * - `listUsers`       requires `users:list`  (system admins hold this via systemAdminPermissions).
 * - `updateUserRoles` requires `users:write` (system admins hold this).
 *
 * Starter ships two built-in roles only (user, system_admin). Forks extend
 * roleDefinitions and this UI separately for custom roles.
 */

const USERS_LIST = 'users:list' as const;
const USERS_WRITE = 'users:write' as const;

/** Effective role preset — maps to the two built-in starter roles only */
export type EffectiveRole = 'standard_user' | 'system_admin';

export interface UserSummary {
  _id: Id<'users'>;
  name: string;
  email?: string;
  type: 'full' | 'anonymous';
  accessLevel: 'user' | 'system_admin';
  roleNames: string[];
  effectiveRole: EffectiveRole;
}

function toEffectiveRole(user: { accessLevel?: 'user' | 'system_admin' }): EffectiveRole {
  if (user.accessLevel === 'system_admin') return 'system_admin';
  return 'standard_user';
}

function presetToStorage(effectiveRole: EffectiveRole): {
  accessLevel: 'user' | 'system_admin';
  roleNames?: string[];
} {
  switch (effectiveRole) {
    case 'system_admin':
      return { accessLevel: 'system_admin', roleNames: undefined };
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
 * Permission: `users:list` — system admins only in the starter; forks may grant via custom roles.
 */
export const listUsers = query({
  args: { ...SessionIdArg },
  handler: async (ctx, args): Promise<UserSummary[]> => {
    const actor = await getAuthUser(ctx, args);
    requireAuthenticatedPermission(actor, USERS_LIST, {
      unauthorizedMessage: 'You must be logged in to list users',
    });

    const users = await ctx.db.query('users').collect();

    return users
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
    effectiveRole: v.union(v.literal('standard_user'), v.literal('system_admin')),
    ...SessionIdArg,
  },
  handler: async (ctx, args) => {
    const actor = await getAuthUser(ctx, args);
    requireAuthenticatedPermission(actor, USERS_WRITE, {
      unauthorizedMessage: 'You must be logged in to update user roles',
    });

    const target = await ctx.db.get('users', args.userId);
    if (!target) {
      throw new ConvexError({ code: 'NOT_FOUND', message: 'User not found' });
    }

    await assertNotLastSystemAdmin(ctx, target, args.effectiveRole);
    // Clearing roleNames (undefined) on system_admin promotion matches the migrations unset pattern.
    await ctx.db.patch('users', args.userId, presetToStorage(args.effectiveRole));
  },
});
