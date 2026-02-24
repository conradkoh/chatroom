/**
 * auth-logout Unit Tests
 *
 * Tests the auth-logout command using injected dependencies.
 * Covers: not authenticated, success, clear failure.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthLogoutDeps } from './deps.js';
import { authLogout } from './index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockDeps(overrides?: Partial<AuthLogoutDeps>): AuthLogoutDeps {
  return {
    session: {
      isAuthenticated: vi.fn().mockReturnValue(true),
      clearAuthData: vi.fn().mockReturnValue(true),
      getAuthFilePath: vi.fn().mockReturnValue('/home/user/.chatroom/auth.jsonc'),
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

let exitSpy: any;
let logSpy: any;
let errorSpy: any;

beforeEach(() => {
  exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

function getAllLogOutput(): string {
  return logSpy.mock.calls.map((c: unknown[]) => (c as string[]).join(' ')).join('\n');
}

function getAllErrorOutput(): string {
  return errorSpy.mock.calls.map((c: unknown[]) => (c as string[]).join(' ')).join('\n');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('authLogout', () => {
  describe('authentication', () => {
    it('exits with code 1 when clearAuthData fails', async () => {
      const deps = createMockDeps({
        session: {
          isAuthenticated: vi.fn().mockReturnValue(true),
          clearAuthData: vi.fn().mockReturnValue(false),
          getAuthFilePath: vi.fn().mockReturnValue('/home/user/.chatroom/auth.jsonc'),
        },
      });

      await authLogout(deps);

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(getAllErrorOutput()).toContain('Failed to clear authentication data');
    });
  });

  describe('success', () => {
    it('logs success when authenticated and clear succeeds', async () => {
      const deps = createMockDeps();

      await authLogout(deps);

      expect(exitSpy).not.toHaveBeenCalled();
      expect(getAllLogOutput()).toContain('Logged out successfully');
      expect(getAllLogOutput()).toContain('/home/user/.chatroom/auth.jsonc');
    });
  });

  describe('not authenticated', () => {
    it('logs info and returns when not authenticated', async () => {
      const deps = createMockDeps({
        session: {
          isAuthenticated: vi.fn().mockReturnValue(false),
          clearAuthData: vi.fn(),
          getAuthFilePath: vi.fn(),
        },
      });

      await authLogout(deps);

      expect(exitSpy).not.toHaveBeenCalled();
      expect(getAllLogOutput()).toContain('Not currently authenticated');
      expect(deps.session.clearAuthData).not.toHaveBeenCalled();
    });
  });
});
