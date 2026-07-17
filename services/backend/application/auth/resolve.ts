import { allPermissions, type Permission } from './permissions';
import { type AppRole, getPermissionsForRole, type RolePermissionGrant } from './roles';
import type { Doc } from '../../convex/_generated/dataModel';

export type UserForPermissions = Pick<Doc<'users'>, 'accessLevel'>;

/**
 * Resolves application roles for a user.
 * Phase 1: maps legacy `accessLevel` to built-in roles.
 */
export function getRolesForUser(user: UserForPermissions): AppRole[] {
  if (user.accessLevel === 'system_admin') {
    return ['system_admin'];
  }
  return ['user'];
}

/**
 * Collects permission grants for the given roles (deduplicated).
 */
export function unionPermissionsForRoles(roles: readonly AppRole[]): Set<RolePermissionGrant> {
  const grants = new Set<RolePermissionGrant>();
  for (const role of roles) {
    for (const permission of getPermissionsForRole(role)) {
      grants.add(permission);
    }
  }
  return grants;
}

/**
 * Returns true when a granted permission satisfies the required permission.
 * Supports exact matches, global `*`, and resource wildcards (`users:*`).
 */
export function permissionGrantMatches(grant: RolePermissionGrant, required: Permission): boolean {
  if (grant === '*') {
    return true;
  }
  if (grant === required) {
    return true;
  }
  if (grant.endsWith(':*')) {
    const prefix = grant.slice(0, -1);
    return required.startsWith(prefix);
  }
  return false;
}

export function getPermissionsForUser(user: UserForPermissions): Set<RolePermissionGrant> {
  return unionPermissionsForRoles(getRolesForUser(user));
}

export function hasPermission(user: UserForPermissions, permission: Permission): boolean {
  const grants = getPermissionsForUser(user);
  for (const grant of grants) {
    if (permissionGrantMatches(grant, permission)) {
      return true;
    }
  }
  return false;
}

/** Resolves concrete registry permissions held by the user (for AuthState and APIs). */
export function getResolvedPermissionsForUser(user: UserForPermissions): Permission[] {
  return allPermissions.filter((permission) => hasPermission(user, permission));
}
