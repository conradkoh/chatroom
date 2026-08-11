/**
 * Application role definitions (keep in sync with services/backend/application/auth/roles.ts).
 */
import { allPermissions, type Permission } from './permissions';

export type WildcardGrant = '*' | `${string}:*`;

export type RolePermissionGrant = Permission | WildcardGrant;

export const systemAdminPermissions = [...allPermissions] as const satisfies readonly Permission[];

export const roleDefinitions = [
  {
    role: 'user',
    permissions: ['attendance:read', 'presentation:read'] as const satisfies readonly Permission[],
  },
  {
    role: 'admin',
    permissions: [
      'admin:access',
      'users:list',
      'users:write',
      'invites:manage',
    ] as const satisfies readonly Permission[],
  },
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
