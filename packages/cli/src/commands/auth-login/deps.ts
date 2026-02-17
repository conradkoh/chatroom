/**
 * Auth-Login Deps — dependency interfaces for the auth-login command.
 *
 * Covers backend operations, auth storage, browser launch, timing,
 * and environment access so that the login flow can be tested
 * without real network calls or browser interactions.
 */

import type { SessionId } from 'convex-helpers/server/sessions';

import type { BackendOps } from '../../infrastructure/deps/index.js';

/** Data shape persisted by saveAuthData. */
export interface AuthData {
  sessionId: SessionId;
  createdAt: string;
  deviceName: string;
  cliVersion: string;
}

/** Auth storage operations. */
export interface AuthStorageOps {
  isAuthenticated: () => boolean;
  getAuthFilePath: () => string;
  saveAuthData: (data: AuthData) => void;
  getDeviceName: () => string;
  getCliVersion: () => string;
}

/** Browser launch abstraction — stubbed in tests. */
export interface BrowserOps {
  open: (url: string) => Promise<void>;
}

/** Clock / timing abstraction. */
export interface ClockOps {
  now: () => number;
  delay: (ms: number) => Promise<void>;
}

/** Process environment abstraction. */
export interface ProcessOps {
  env: Record<string, string | undefined>;
  platform: string;
  exit: (code: number) => void;
  stdoutWrite: (text: string) => boolean;
}

/** Aggregated dependencies for authLogin. */
export interface AuthLoginDeps {
  backend: BackendOps;
  auth: AuthStorageOps;
  browser: BrowserOps;
  clock: ClockOps;
  process: ProcessOps;
}
