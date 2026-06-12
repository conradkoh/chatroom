/**
 * AuthLogoutService — Effect Context.Tag for auth-logout operations
 *
 * This service wraps local session storage operations (not Convex-related).
 */

import { Context, type Effect } from 'effect';

export interface AuthLogoutServiceShape {
  isAuthenticated: () => Effect.Effect<boolean>;
  clearAuthData: () => Effect.Effect<boolean>;
  getAuthFilePath: () => Effect.Effect<string>;
}

export class AuthLogoutService extends Context.Tag('AuthLogoutService')<
  AuthLogoutService,
  AuthLogoutServiceShape
>() {}
