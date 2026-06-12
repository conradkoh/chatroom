/**
 * AuthLoginEnvService — Effect Context.Tag for auth-login environment operations.
 *
 * Merges auth storage, browser, clock, and process env into one service tag
 * to keep test setup simple — one Context.Tag, one mock layer in tests.
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { Context, type Effect } from 'effect';

import type { AuthData } from './deps.js';

export interface AuthLoginEnvServiceShape {
  // Auth storage
  isAuthenticated: () => Effect.Effect<boolean>;
  getAuthFilePath: () => Effect.Effect<string>;
  saveAuthData: (data: AuthData) => Effect.Effect<void, Error>;
  getDeviceName: () => Effect.Effect<string>;
  getCliVersion: () => Effect.Effect<string>;
  getSessionId: () => Effect.Effect<SessionId | null>;
  // Browser
  openBrowser: (url: string) => Effect.Effect<void>;
  // Clock
  now: () => Effect.Effect<number>;
  delay: (ms: number) => Effect.Effect<void>;
  // Process
  env: () => Effect.Effect<Record<string, string | undefined>>;
  stdoutWrite: (text: string) => Effect.Effect<void>;
}

export class AuthLoginEnvService extends Context.Tag('AuthLoginEnvService')<
  AuthLoginEnvService,
  AuthLoginEnvServiceShape
>() {}
