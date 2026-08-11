import { describe, expect, it } from 'vitest';

import { allPermissions, type Permission } from './permissions';
import {
  getPermissionsForUser,
  getResolvedPermissionsForUser,
  getRolesForUser,
  hasPermission,
  permissionGrantMatches,
  unionPermissionsForRoles,
} from './resolve';
import { systemAdminPermissions } from './roles';

describe('permissionGrantMatches', () => {
  it('matches exact permissions', () => {
    expect(permissionGrantMatches('users:list', 'users:list')).toBe(true);
    expect(permissionGrantMatches('users:list', 'users:read')).toBe(false);
  });

  it('matches global wildcard', () => {
    expect(permissionGrantMatches('*', 'users:list')).toBe(true);
  });

  it('matches resource wildcards', () => {
    expect(permissionGrantMatches('users:*', 'users:list')).toBe(true);
    expect(permissionGrantMatches('users:*', 'users:write')).toBe(true);
    expect(permissionGrantMatches('users:*', 'settings:read')).toBe(false);
  });
});

describe('getRolesForUser', () => {
  it('maps accessLevel to roles', () => {
    expect(getRolesForUser({ accessLevel: undefined })).toEqual(['user']);
    expect(getRolesForUser({ accessLevel: 'user' })).toEqual(['user']);
    expect(getRolesForUser({ accessLevel: 'system_admin' })).toEqual(['system_admin']);
  });
});

describe('getRolesForUser with roleNames', () => {
  it('reads roleNames when present', () => {
    expect(getRolesForUser({ roleNames: ['user'] })).toEqual(['user']);
  });

  it('filters legacy manager role from roleNames after removal from registry', () => {
    expect(getRolesForUser({ roleNames: ['user', 'manager'] })).toEqual(['user']);
  });

  it('falls back to accessLevel when roleNames is empty', () => {
    expect(getRolesForUser({ roleNames: [], accessLevel: 'system_admin' })).toEqual([
      'system_admin',
    ]);
  });

  it('falls back to accessLevel when roleNames is undefined', () => {
    expect(getRolesForUser({ accessLevel: 'user' })).toEqual(['user']);
  });

  it('filters unknown role names', () => {
    expect(getRolesForUser({ roleNames: ['user', 'nonexistent'] })).toEqual(['user']);
  });

  it('falls back to accessLevel when all roleNames are unknown', () => {
    expect(getRolesForUser({ roleNames: ['bogus'], accessLevel: 'system_admin' })).toEqual([
      'system_admin',
    ]);
  });

  it('always grants system_admin when accessLevel is system_admin, regardless of roleNames', () => {
    expect(getRolesForUser({ accessLevel: 'system_admin', roleNames: ['user'] })).toEqual([
      'system_admin',
    ]);
    expect(getRolesForUser({ accessLevel: 'system_admin' })).toEqual(['system_admin']);
  });
});

describe('hasPermission with roleNames', () => {
  it('grants system admin permissions without roleNames migration', () => {
    const user = { accessLevel: 'system_admin' as const };
    expect(hasPermission(user, 'system_admin:access')).toBe(true);
    expect(
      hasPermission({ accessLevel: 'system_admin', roleNames: ['user'] }, 'system_admin:access')
    ).toBe(true);
  });
});

describe('hasPermission', () => {
  it('grants default user permissions', () => {
    const user = { accessLevel: 'user' as const };
    expect(hasPermission(user, 'attendance:read')).toBe(true);
    expect(hasPermission(user, 'users:list')).toBe(false);
    expect(hasPermission(user, 'system_admin:access')).toBe(false);
  });

  it('grants explicit system_admin permissions', () => {
    const user = { accessLevel: 'system_admin' as const };
    for (const permission of systemAdminPermissions) {
      expect(hasPermission(user, permission)).toBe(true);
    }
    expect(hasPermission(user, 'system_admin:access')).toBe(true);
  });
});

describe('systemAdminPermissions', () => {
  it('includes every registered permission', () => {
    expect(new Set(systemAdminPermissions)).toEqual(new Set(allPermissions));
  });
});

describe('unionPermissionsForRoles', () => {
  it('collects grants for the user role', () => {
    const grants = unionPermissionsForRoles(['user']);
    expect(grants.has('attendance:read')).toBe(true);
    expect(grants.has('presentation:read')).toBe(true);
    expect(grants.has('users:list')).toBe(false);
  });
});

describe('getResolvedPermissionsForUser', () => {
  it('returns concrete registry permissions for a user', () => {
    expect(getResolvedPermissionsForUser({ accessLevel: 'user' })).toEqual([
      'attendance:read',
      'presentation:read',
    ]);
    expect(getResolvedPermissionsForUser({ accessLevel: 'system_admin' })).toEqual(
      expect.arrayContaining([...systemAdminPermissions])
    );
    expect(getResolvedPermissionsForUser({ accessLevel: 'system_admin' })).toHaveLength(
      allPermissions.length
    );
  });
});

describe('getPermissionsForUser', () => {
  it('returns explicit grants for system admin (no wildcard)', () => {
    const grants = getPermissionsForUser({ accessLevel: 'system_admin' });
    expect(grants.has('*')).toBe(false);
    expect(hasPermission({ accessLevel: 'system_admin' }, 'settings:write' as Permission)).toBe(
      true
    );
  });
});

describe('admin role', () => {
  const adminUser = { accessLevel: 'user' as const, roleNames: ['admin'] };

  it('has admin:access, users:list, and invites:manage', () => {
    expect(hasPermission(adminUser, 'admin:access')).toBe(true);
    expect(hasPermission(adminUser, 'users:list')).toBe(true);
    expect(hasPermission(adminUser, 'invites:manage')).toBe(true);
  });

  it('lacks system_admin:access', () => {
    expect(hasPermission(adminUser, 'system_admin:access')).toBe(false);
  });

  it('resolves roleNames admin via getRolesForUser', () => {
    expect(getRolesForUser({ accessLevel: 'user', roleNames: ['admin'] })).toEqual(['admin']);
  });
});
