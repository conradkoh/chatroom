import type { AuthState } from '@workspace/backend/modules/auth/types/AuthState';

import { allPermissions, type Permission } from './permissions';
import { type AppRole, getPermissionsForRole, type RolePermissionGrant } from './roles';

/** Minimal user shape for permission resolution (matches backend UserForPermissions). */
export type UserForPermissions = {
  accessLevel?: 'user' | 'system_admin';
};

export function getRolesForUser(user: UserForPermissions): AppRole[] {
  if (user.accessLevel === 'system_admin') {
    return ['system_admin'];
  }
  return ['user'];
}

export function unionPermissionsForRoles(roles: readonly AppRole[]): Set<RolePermissionGrant> {
  const grants = new Set<RolePermissionGrant>();
  for (const role of roles) {
    for (const permission of getPermissionsForRole(role)) {
      grants.add(permission);
    }
  }
  return grants;
}

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

/**
 * Permission check for AuthState — tolerates missing `permissions` (stale session/cache).
 */
export function authStateHasPermission(
  authState: AuthState | undefined,
  permission: Permission
): boolean {
  if (!authState || authState.state !== 'authenticated') {
    return false;
  }
  if (Array.isArray(authState.permissions)) {
    return authState.permissions.includes(permission);
  }
  return hasPermission(authState.user, permission);
}

/** Resolves concrete registry permissions held by the user (mirrors backend). */
export function getResolvedPermissionsForUser(user: UserForPermissions): Permission[] {
  return allPermissions.filter((permission) => hasPermission(user, permission));
}
