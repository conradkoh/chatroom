/**
 * auth-status Unit Tests
 *
 * Tests the auth-status command using injected dependencies.
 * Covers: auth (exits/returns when not authenticated), success, validation error.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthStatusDeps } from './deps.js';
import { authStatus } from './index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_AUTH_DATA = {
  sessionId: 'test-session-id',
  createdAt: '2024-01-01T00:00:00.000Z',
  deviceName: 'test-device',
};

function createMockDeps(overrides?: Partial<AuthStatusDeps>): AuthStatusDeps {
  return {
    backend: {
      mutation: vi.fn().mockResolvedValue(undefined),
      query: vi.fn().mockResolvedValue({ valid: true, userName: 'Test User' }),
    },
    session: {
      loadAuthData: vi.fn().mockReturnValue(TEST_AUTH_DATA),
      getAuthFilePath: vi.fn().mockReturnValue('/home/user/.chatroom/auth.jsonc'),
      isAuthenticated: vi.fn().mockReturnValue(true),
    },
    getVersion: vi.fn().mockReturnValue('1.0.0'),
    ensureMachineRegistered: vi.fn().mockReturnValue({
      machineId: 'machine-123',
      hostname: 'test-host',
      os: 'darwin',
      availableHarnesses: ['opencode'],
      harnessVersions: {},
    }),
    listAvailableModels: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

let logSpy: any;

beforeEach(() => {
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

function getAllLogOutput(): string {
  return logSpy.mock.calls.map((c: unknown[]) => (c as string[]).join(' ')).join('\n');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('authStatus', () => {
  describe('authentication', () => {
    it('shows not authenticated when not logged in', async () => {
      const deps = createMockDeps({
        session: {
          loadAuthData: vi.fn().mockReturnValue(null),
          getAuthFilePath: vi.fn().mockReturnValue('/home/user/.chatroom/auth.jsonc'),
          isAuthenticated: vi.fn().mockReturnValue(false),
        },
      });

      await authStatus(deps);

      expect(getAllLogOutput()).toContain('Not authenticated');
      expect(getAllLogOutput()).toContain('chatroom auth login');
      expect(deps.backend.query).not.toHaveBeenCalled();
    });
  });

  describe('success', () => {
    it('shows auth status and validates session when authenticated', async () => {
      const deps = createMockDeps();

      await authStatus(deps);

      expect(getAllLogOutput()).toContain('AUTHENTICATION STATUS');
      expect(getAllLogOutput()).toContain('Session is valid');
      expect(getAllLogOutput()).toContain('Test User');
      expect(getAllLogOutput()).toContain('Machine registered');
      expect(deps.backend.query).toHaveBeenCalled();
      expect(deps.backend.mutation).toHaveBeenCalled();
    });
  });

  describe('error', () => {
    it('handles invalid session gracefully', async () => {
      const deps = createMockDeps({
        backend: {
          mutation: vi.fn().mockResolvedValue(undefined),
          query: vi.fn().mockResolvedValue({ valid: false, reason: 'Session expired' }),
        },
      });

      await authStatus(deps);

      expect(getAllLogOutput()).toContain('Session is invalid');
      expect(getAllLogOutput()).toContain('Session expired');
      expect(getAllLogOutput()).toContain('chatroom auth login');
      expect(deps.backend.mutation).not.toHaveBeenCalled();
    });

    it('handles validation query failure gracefully', async () => {
      const deps = createMockDeps({
        backend: {
          mutation: vi.fn(),
          query: vi.fn().mockRejectedValue(new Error('Network error')),
        },
      });

      await authStatus(deps);

      expect(getAllLogOutput()).toContain('Could not validate session');
      expect(getAllLogOutput()).toContain('Network error');
    });

    it('handles machine registration failure gracefully', async () => {
      const deps = createMockDeps({
        ensureMachineRegistered: vi.fn().mockImplementation(() => {
          throw new Error('Machine config error');
        }),
      });

      await authStatus(deps);

      expect(getAllLogOutput()).toContain('Session is valid');
      expect(getAllLogOutput()).toContain('Machine registration skipped');
      expect(getAllLogOutput()).toContain('Machine config error');
    });
  });
});
