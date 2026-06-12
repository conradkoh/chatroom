/**
 * Auth Session Service — Effect service for auth-status specific session operations.
 *
 * This service tag provides auth-specific session operations that are separate
 * from the minimal SessionService used elsewhere. It includes operations for
 * loading auth data, checking authentication status, and retrieving machine config.
 */

import type { Effect } from 'effect';
import { Context } from 'effect';

import type { MachineConfig } from '../../infrastructure/machine/types.js';

/**
 * Auth data structure returned by loadAuthData.
 */
export interface AuthData {
  sessionId: string;
  createdAt: string;
  deviceName?: string;
}

/**
 * Auth session service shape — operations specific to the auth-status command.
 */
export interface AuthSessionServiceShape {
  /** Load authentication data from storage */
  loadAuthData: () => Effect.Effect<AuthData | null, Error>;
  /** Get the path to the auth file */
  getAuthFilePath: () => Effect.Effect<string>;
  /** Check if the user is authenticated */
  isAuthenticated: () => Effect.Effect<boolean>;
  /** Get CLI version */
  getVersion: () => Effect.Effect<string>;
  /** Load local machine configuration */
  loadMachineConfig: () => Effect.Effect<MachineConfig | null>;
}

/**
 * Auth Session Service tag for dependency injection.
 */
export class AuthSessionService extends Context.Tag('AuthSessionService')<
  AuthSessionService,
  AuthSessionServiceShape
>() {}
