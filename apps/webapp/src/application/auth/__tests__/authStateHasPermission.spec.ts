import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import type { AuthState } from '@workspace/backend/modules/auth/types/AuthState';
import { describe, expect, it } from 'vitest';

import { SYSTEM_ADMIN_ACCESS_PERMISSION } from '../permissions';
import { authStateHasPermission } from '../resolve';

const authenticatedUser = {
  _id: 'user-1' as Id<'users'>,
  _creationTime: 0,
  type: 'anonymous' as const,
  name: 'Test',
};

function authenticatedState(
  overrides: Partial<Extract<AuthState, { state: 'authenticated' }>> = {}
): Extract<AuthState, { state: 'authenticated' }> {
  return {
    sessionId: 'session-1',
    state: 'authenticated',
    user: authenticatedUser,
    accessLevel: 'user',
    permissions: ['attendance:read', 'presentation:read'],
    ...overrides,
  };
}

describe('authStateHasPermission', () => {
  it('returns false when auth state is undefined', () => {
    expect(authStateHasPermission(undefined, 'attendance:read')).toBe(false);
  });

  it('returns false when unauthenticated', () => {
    const state: AuthState = {
      sessionId: 'session-1',
      state: 'unauthenticated',
      reason: 'session_not_found',
    };
    expect(authStateHasPermission(state, 'attendance:read')).toBe(false);
  });

  it('uses permissions array when present', () => {
    const state = authenticatedState({
      permissions: ['attendance:read'],
    });
    expect(authStateHasPermission(state, 'attendance:read')).toBe(true);
    expect(authStateHasPermission(state, 'presentation:read')).toBe(false);
  });

  it('resolves from user when permissions array is missing (stale session)', () => {
    const state = authenticatedState({
      permissions: undefined,
    });
    expect(authStateHasPermission(state, 'attendance:read')).toBe(true);
    expect(authStateHasPermission(state, SYSTEM_ADMIN_ACCESS_PERMISSION)).toBe(false);
  });

  it('resolves system admin when permissions missing and user is system_admin', () => {
    const state = authenticatedState({
      user: { ...authenticatedUser, accessLevel: 'system_admin' },
      accessLevel: 'system_admin',
      permissions: undefined,
    });
    expect(authStateHasPermission(state, SYSTEM_ADMIN_ACCESS_PERMISSION)).toBe(true);
  });
});
