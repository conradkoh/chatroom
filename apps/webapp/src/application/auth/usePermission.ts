'use client';

import type { Permission } from './permissions';
import { authStateHasPermission } from './resolve';

import { useAuthState } from '@/modules/auth/AuthProvider';

/**
 * Returns whether the authenticated user holds the given permission.
 * Uses server-resolved `authState.permissions` when present; otherwise resolves from the user record.
 */
export function useHasPermission(permission: Permission): boolean {
  const authState = useAuthState();
  return authStateHasPermission(authState, permission);
}
