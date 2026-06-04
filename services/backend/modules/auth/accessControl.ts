import type { Doc } from '../../convex/_generated/dataModel';

/**
 * Access level utility functions for user authorization.
 * Provides type-safe access level checking for the application.
 */

export type AccessLevel = 'user' | 'system_admin';

/**
 * Gets a user's access level with fallback to 'user' if undefined.
 * This centralizes the logic for handling optional accessLevel fields during migration.
 * @param user - The user document to check
 * @returns The user's access level, defaulting to 'user' if undefined
 */
export function getAccessLevel(user: Doc<'users'>): AccessLevel {
  return user.accessLevel ?? 'user';
}

/**
 * Checks if a user has at least the specified access level.
 * @deprecated Prefer `hasPermission` from `application/auth` for authorization checks.
 * `accessLevel` is legacy assignment data that maps to roles — do not use for new guards.
 */
export function hasAccessLevel(user: Doc<'users'>, requiredLevel: AccessLevel): boolean {
  if (requiredLevel === 'user') {
    return true; // All users have 'user' level access
  }

  if (requiredLevel === 'system_admin') {
    return getAccessLevel(user) === 'system_admin';
  }

  return false;
}

/**
 * Gets a user's access level as a string.
 * @param user - The user document
 * @returns The user's access level
 * @deprecated Use getAccessLevel instead for consistency
 */
export function getUserAccessLevel(user: Doc<'users'>): AccessLevel {
  return getAccessLevel(user);
}
