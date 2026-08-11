/**
 * Application permission registry.
 * Add new permissions here before referencing them in roles.
 */
const permissions = {
  'system_admin:access': {
    description:
      'Access platform system administration UI (system administrators only — not business/org admin roles)',
  },
  'users:list': { description: 'List users' },
  'users:read': { description: 'View user details' },
  'users:write': { description: 'Create or update users' },
  'settings:read': { description: 'View application settings' },
  'settings:write': { description: 'Update application settings' },
  'invites:manage': { description: 'Create and manage invite codes' },
  'admin:access': { description: 'Access business administration UI' },
  'attendance:read': { description: 'View attendance records' },
  'attendance:manage': { description: 'Manage attendance records' },
  'presentation:read': { description: 'View presentations' },
} as const;

export type Permission = keyof typeof permissions;

export const allPermissions = Object.keys(permissions) as Permission[];

/** Platform system administration — gate for system-admin-only endpoints. */
export const SYSTEM_ADMIN_ACCESS_PERMISSION = 'system_admin:access' as const satisfies Permission;

export const INVITES_MANAGE_PERMISSION = 'invites:manage' as const satisfies Permission;

/** Business administration UI — slice 2 frontend portal. */
// fallow-ignore-next-line unused-export
export const ADMIN_ACCESS_PERMISSION = 'admin:access' as const satisfies Permission;
