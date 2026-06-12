/**
 * Auth Status Effect Pipeline Tests
 *
 * Tests the pure Effect pipelines (authStatusEffect) using test layers.
 * These tests verify typed error handling and business logic without
 * testing process.exit behavior (which belongs in boundary tests).
 */

import { Cause, Effect, Layer } from 'effect';
import { describe, expect, test } from 'vitest';

import { AuthSessionService, type AuthData } from './auth-status-service.js';
import { authStatusEffect, type AuthStatusError } from './index.js';
import type { MachineConfig } from '../../infrastructure/machine/types.js';
import { BackendService } from '../../infrastructure/services/index.js';

// Import the Effect function we'll implement

// ─── Test Helpers ──────────────────────────────────────────────────────────

/** Create a test backend service with a single query response */
function makeTestBackend(queryResponse: unknown | Error) {
  return Layer.succeed(BackendService, {
    query: (_endpoint: any, _args: unknown) => {
      if (queryResponse instanceof Error) {
        return Effect.fail(queryResponse) as any;
      }
      return Effect.succeed(queryResponse) as any;
    },
    mutation: () => Effect.die('mutation not implemented in test backend') as any,
    action: () => Effect.die('action not implemented in test backend') as any,
  });
}

/** Create a test auth session service with configurable responses */
function makeTestAuthSession(config: {
  isAuthenticated?: boolean | Error;
  authData?: AuthData | null | Error;
  authFilePath?: string;
  version?: string;
  machineConfig?: MachineConfig | null;
}) {
  return Layer.succeed(AuthSessionService, {
    loadAuthData: () =>
      config.authData instanceof Error
        ? Effect.fail(config.authData)
        : Effect.succeed(config.authData ?? null),
    getAuthFilePath: () => Effect.succeed(config.authFilePath ?? '/test/auth.json'),
    isAuthenticated: () =>
      typeof config.isAuthenticated === 'boolean'
        ? Effect.succeed(config.isAuthenticated)
        : Effect.succeed(false),
    getVersion: () => Effect.succeed(config.version ?? '1.0.0'),
    loadMachineConfig: () => Effect.succeed(config.machineConfig ?? null),
  });
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('authStatusEffect', () => {
  test('fails with NotAuthenticated when isAuthenticated returns false', async () => {
    const testLayer = Layer.mergeAll(
      makeTestBackend(null), // Backend won't be called
      makeTestAuthSession({ isAuthenticated: false, authData: null })
    );

    const exit = await Effect.runPromiseExit(authStatusEffect().pipe(Effect.provide(testLayer)));

    expect(exit._tag).toBe('Failure');
    if (exit._tag === 'Failure') {
      const error = Cause.failureOption(exit.cause).pipe((option) =>
        option._tag === 'Some' ? option.value : null
      ) as AuthStatusError | null;
      expect(error).not.toBeNull();
      expect(error?._tag).toBe('NotAuthenticated');
    }
  });

  test('fails with SessionLoadError when loadAuthData throws', async () => {
    const testLayer = Layer.mergeAll(
      makeTestBackend(null), // Backend won't be called
      makeTestAuthSession({
        isAuthenticated: true,
        authData: new Error('Storage read failed'),
      })
    );

    const exit = await Effect.runPromiseExit(authStatusEffect().pipe(Effect.provide(testLayer)));

    expect(exit._tag).toBe('Failure');
    if (exit._tag === 'Failure') {
      const error = Cause.failureOption(exit.cause).pipe((option) =>
        option._tag === 'Some' ? option.value : null
      ) as AuthStatusError | null;
      expect(error).not.toBeNull();
      expect(error?._tag).toBe('SessionLoadError');
      if (error?._tag === 'SessionLoadError') {
        expect(error.cause.message).toBe('Storage read failed');
      }
    }
  });

  test('succeeds with valid session and prints success message', async () => {
    const authData: AuthData = {
      sessionId: 'sess-123',
      createdAt: '2024-01-01T00:00:00Z',
      deviceName: 'test-device',
    };

    const validationResult = {
      valid: true,
      userName: 'Test User',
    };

    const testLayer = Layer.mergeAll(
      makeTestBackend(validationResult),
      makeTestAuthSession({
        isAuthenticated: true,
        authData,
        authFilePath: '/test/auth.json',
        version: '1.0.0',
        machineConfig: null,
      })
    );

    const exit = await Effect.runPromiseExit(authStatusEffect().pipe(Effect.provide(testLayer)));

    expect(exit._tag).toBe('Success');
  });

  test('succeeds with invalid session and prints warning message', async () => {
    const authData: AuthData = {
      sessionId: 'sess-invalid',
      createdAt: '2024-01-01T00:00:00Z',
    };

    const validationResult = {
      valid: false,
      reason: 'Session expired',
    };

    const testLayer = Layer.mergeAll(
      makeTestBackend(validationResult),
      makeTestAuthSession({
        isAuthenticated: true,
        authData,
        authFilePath: '/test/auth.json',
        version: '1.0.0',
        machineConfig: null,
      })
    );

    const exit = await Effect.runPromiseExit(authStatusEffect().pipe(Effect.provide(testLayer)));

    expect(exit._tag).toBe('Success');
  });

  test('fails with BackendError when validateSession query throws', async () => {
    const authData: AuthData = {
      sessionId: 'sess-123',
      createdAt: '2024-01-01T00:00:00Z',
    };

    const testLayer = Layer.mergeAll(
      makeTestBackend(new Error('Network error')),
      makeTestAuthSession({
        isAuthenticated: true,
        authData,
        authFilePath: '/test/auth.json',
        version: '1.0.0',
        machineConfig: null,
      })
    );

    const exit = await Effect.runPromiseExit(authStatusEffect().pipe(Effect.provide(testLayer)));

    expect(exit._tag).toBe('Failure');
    if (exit._tag === 'Failure') {
      const error = Cause.failureOption(exit.cause).pipe((option) =>
        option._tag === 'Some' ? option.value : null
      ) as AuthStatusError | null;
      expect(error).not.toBeNull();
      expect(error?._tag).toBe('BackendError');
      if (error?._tag === 'BackendError') {
        expect(error.cause.message).toBe('Network error');
      }
    }
  });
});
