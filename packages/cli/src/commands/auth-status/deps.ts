/**
 * Auth-Status Deps — dependency interfaces for the auth-status command.
 *
 * Uses backend queries and session storage for auth status display and validation.
 */

import type { MachineConfig } from '../../infrastructure/machine/types.js';

/**
 * Backend operations for auth-status (query-only — no mutations needed).
 */
export interface AuthStatusBackendOps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query: (endpoint: any, args: any) => Promise<any>;
}

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
  backend: AuthStatusBackendOps;
  session: AuthStatusSessionOps;
  getVersion: () => string;
  /** Read local machine config (no backend sync) */
  loadMachineConfig: () => MachineConfig | null;
}
