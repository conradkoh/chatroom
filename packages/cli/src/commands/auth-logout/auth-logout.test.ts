/**
 * Auth Logout Effect Pipeline Tests
 *
 * Tests the pure Effect pipelines using test layers.
 */

import { Cause, Effect, Layer } from 'effect';
import { describe, expect, test, vi } from 'vitest';

import { AuthLogoutService } from './auth-logout-service.js';
import { authLogoutEffect, type AuthLogoutError } from './index.js';

// ─── Test Helpers ──────────────────────────────────────────────────────────

/** Create a test auth logout service with configurable responses */
function makeTestAuthLogout(config: {
  isAuthenticated?: boolean;
  clearAuthData?: boolean;
  authFilePath?: string;
}) {
  return Layer.succeed(AuthLogoutService, {
    isAuthenticated: vi.fn(() =>
      Effect.succeed(config.isAuthenticated !== undefined ? config.isAuthenticated : true)
    ),
    clearAuthData: vi.fn(() =>
      Effect.succeed(config.clearAuthData !== undefined ? config.clearAuthData : true)
    ),
    getAuthFilePath: vi.fn(() => Effect.succeed(config.authFilePath ?? '/tmp/chatroom-auth.json')),
  });
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('authLogoutEffect', () => {
  test('succeeds when authenticated and cleared successfully', async () => {
    const testLayer = makeTestAuthLogout({
      isAuthenticated: true,
      clearAuthData: true,
      authFilePath: '/tmp/test-auth.json',
    });

    const exit = await Effect.runPromiseExit(authLogoutEffect().pipe(Effect.provide(testLayer)));

    expect(exit._tag).toBe('Success');
  });

  test('succeeds with info message when not authenticated', async () => {
    const testLayer = makeTestAuthLogout({
      isAuthenticated: false,
    });

    const exit = await Effect.runPromiseExit(authLogoutEffect().pipe(Effect.provide(testLayer)));

    expect(exit._tag).toBe('Success');
  });

  test('fails with ClearFailed when clearAuthData returns false', async () => {
    const testLayer = makeTestAuthLogout({
      isAuthenticated: true,
      clearAuthData: false,
    });

    const exit = await Effect.runPromiseExit(authLogoutEffect().pipe(Effect.provide(testLayer)));

    expect(exit._tag).toBe('Failure');
    if (exit._tag === 'Failure') {
      const error = Cause.failureOption(exit.cause).pipe((option) =>
        option._tag === 'Some' ? option.value : null
      ) as AuthLogoutError | null;
      expect(error).not.toBeNull();
      expect(error?._tag).toBe('ClearFailed');
    }
  });
});
