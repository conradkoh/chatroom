/**
 * Application permission registry (keep in sync with services/backend/application/auth/permissions.ts).
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
  'auth:provider:manage': { description: 'Configure authentication providers' },
  'attendance:read': { description: 'View attendance records' },
  'attendance:manage': { description: 'Manage attendance records' },
  'presentation:read': { description: 'View presentations' },
} as const;

export type Permission = keyof typeof permissions;

export const allPermissions = Object.keys(permissions) as Permission[];

/** Platform system administration UI — use for authorization checks, not the `system_admin` role name. */
export const SYSTEM_ADMIN_ACCESS_PERMISSION = 'system_admin:access' as const satisfies Permission;
