'use client';

import type { Permission } from './permissions';

import { useAuthState } from '@/modules/auth/AuthProvider';

/**
 * Returns whether the authenticated user holds the given permission (from AuthState.permissions).
 */
export function useHasPermission(permission: Permission): boolean {
  const authState = useAuthState();

  if (!authState || authState.state !== 'authenticated') {
    return false;
  }

  return authState.permissions.includes(permission);
}
