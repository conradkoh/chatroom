// Direct imports from source files (not barrel) after fallow cleanup trimmed the barrel
import { allPermissions as backendPermissions } from '@workspace/backend/application/auth/permissions';
import { roleDefinitions as backendRoles } from '@workspace/backend/application/auth/roles';
import { describe, expect, it } from 'vitest';

import { allPermissions as webappPermissions } from '../permissions';
import { roleDefinitions as webappRoles } from '../roles';

describe('RBAC registry sync (backend vs webapp)', () => {
  it('has matching permission keys', () => {
    expect([...webappPermissions].sort()).toEqual([...backendPermissions].sort());
  });

  it('has matching role names and permission grants', () => {
    const serialize = (roles: typeof backendRoles) =>
      roles.map((definition) => ({
        role: definition.role,
        permissions: [...definition.permissions],
      }));

    expect(serialize(webappRoles)).toEqual(serialize(backendRoles));
  });
});
