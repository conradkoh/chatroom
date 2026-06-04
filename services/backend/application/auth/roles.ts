import { allPermissions, type Permission } from './permissions';

/** Wildcard grants used in role definitions (not in the permission registry). */
export type WildcardGrant = '*' | `${string}:*`;

export type RolePermissionGrant = Permission | WildcardGrant;

/**
 * Explicit permission set for system administrators (no wildcard).
 * Must include every key in `permissions` — update when adding new permissions.
 */
export const systemAdminPermissions = [...allPermissions] as const satisfies readonly Permission[];

export const roleDefinitions = [
  {
    role: 'user',
    permissions: ['attendance:read', 'presentation:read'] as const satisfies readonly Permission[],
  },
  // Phase 1b: assign via users.roleNames — not active until then.
  // {
  //   role: 'manager',
  //   permissions: [
  //     'users:list',
  //     'users:read',
  //     'attendance:manage',
  //   ] as const satisfies readonly Permission[],
  // },
  {
    role: 'system_admin',
    permissions: systemAdminPermissions,
  },
] as const;

export type AppRole = (typeof roleDefinitions)[number]['role'];

const roleMap = new Map<AppRole, readonly RolePermissionGrant[]>(
  roleDefinitions.map((definition) => [definition.role, definition.permissions])
);

export function getPermissionsForRole(role: AppRole): readonly RolePermissionGrant[] {
  const grants = roleMap.get(role);
  if (!grants) {
    throw new Error(`Unknown role: ${role}`);
  }
  return grants;
}
