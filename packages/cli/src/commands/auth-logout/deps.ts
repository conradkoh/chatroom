/**
 * Auth-Logout Deps — dependency interfaces for the auth-logout command.
 *
 * Uses session storage operations for clearing auth data.
 */

/**
 * Session storage operations for auth-logout (clear, check, path).
 */
export interface AuthLogoutSessionOps {
  isAuthenticated: () => Promise<boolean>;
  clearAuthData: () => Promise<boolean>;
  getAuthFilePath: () => string;
}

/**
 * All external dependencies for the auth-logout command.
 */
export interface AuthLogoutDeps {
  session: AuthLogoutSessionOps;
}
