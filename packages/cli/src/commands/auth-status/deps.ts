/**
 * Auth-Status Deps — dependency interfaces for the auth-status command.
 *
 * Uses BackendOps and session storage for auth status display and validation.
 */

import type { BackendOps } from '../../infrastructure/deps/index.js';
import type { MachineRegistrationInfo } from '../../infrastructure/machine/types.js';

/**
 * Session storage operations for auth-status (load, path, check).
 */
export interface AuthStatusSessionOps {
  loadAuthData: () => { sessionId: string; createdAt: string; deviceName?: string } | null;
  getAuthFilePath: () => string;
  isAuthenticated: () => boolean;
}

/**
 * All external dependencies for the auth-status command.
 */
export interface AuthStatusDeps {
  backend: BackendOps;
  session: AuthStatusSessionOps;
  getVersion: () => string;
  ensureMachineRegistered: () => MachineRegistrationInfo;
  /** Discover available models from harnesses (optional, non-critical) */
  listAvailableModels: () => Promise<Record<string, string[]>>;
}
