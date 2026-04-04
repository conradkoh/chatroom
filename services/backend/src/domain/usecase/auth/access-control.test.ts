import { describe, it, expect } from 'vitest';
import {
  getAccessLevel,
  isSystemAdmin,
  hasAccessLevel,
} from './access-control';

// Mock Doc<'users'> shape — only needs accessLevel field
function mockUser(accessLevel?: string) {
  return { accessLevel } as any;
}

describe('getAccessLevel', () => {
  it('returns user access level', () => {
    expect(getAccessLevel(mockUser('user'))).toBe('user');
  });

  it('returns system_admin access level', () => {
    expect(getAccessLevel(mockUser('system_admin'))).toBe('system_admin');
  });

  it('defaults to user when undefined', () => {
    expect(getAccessLevel(mockUser(undefined))).toBe('user');
  });
});

describe('isSystemAdmin', () => {
  it('returns true for system admin', () => {
    expect(isSystemAdmin(mockUser('system_admin'))).toBe(true);
  });

  it('returns false for regular user', () => {
    expect(isSystemAdmin(mockUser('user'))).toBe(false);
  });

  it('returns false when undefined', () => {
    expect(isSystemAdmin(mockUser(undefined))).toBe(false);
  });
});

describe('hasAccessLevel', () => {
  it('all users have user level', () => {
    expect(hasAccessLevel(mockUser('user'), 'user')).toBe(true);
  });

  it('regular user does not have system_admin level', () => {
    expect(hasAccessLevel(mockUser('user'), 'system_admin')).toBe(false);
  });

  it('system admin has system_admin level', () => {
    expect(hasAccessLevel(mockUser('system_admin'), 'system_admin')).toBe(true);
  });

  it('system admin also has user level', () => {
    expect(hasAccessLevel(mockUser('system_admin'), 'user')).toBe(true);
  });
});
