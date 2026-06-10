/**
 * Auth Login Effect Pipeline Tests
 *
 * Tests the pure Effect pipeline (authLoginEffect) using test layers.
 * Covers typed error handling and business logic without triggering
 * real browser launches, network calls, or process.exit.
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import type { Exit } from 'effect';
import { Cause, Effect, Layer } from 'effect';
import { describe, expect, test, vi } from 'vitest';

import { AuthLoginEnvService } from './auth-login-service.js';
import { authLoginEffect, type AuthLoginError } from './index.js';
import { BackendService } from '../../infrastructure/services/index.js';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('../../infrastructure/convex/client.js', () => ({
  getConvexUrl: vi.fn().mockReturnValue('http://localhost:3210'),
  getConvexClient: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

type QueryResponse = Record<string, unknown>;
type MutationResponse = Record<string, unknown>;

/** Create a test BackendService with configurable responses. */
function makeTestBackend(opts: {
  queryResponses?: (QueryResponse | Error)[];
  mutationResponse?: MutationResponse | Error;
}) {
  let queryCallCount = 0;
  const queryResponses = opts.queryResponses ?? [];

  return Layer.succeed(BackendService, {
    query: (_endpoint: unknown, _args: unknown) => {
      const response = queryResponses[queryCallCount++];
      if (response === undefined) {
        return Effect.fail(new Error('No more query responses configured')) as any;
      }
      if (response instanceof Error) {
        return Effect.fail(response) as any;
      }
      return Effect.succeed(response) as any;
    },
    mutation: (_endpoint: unknown, _args: unknown) => {
      const response = opts.mutationResponse;
      if (response === undefined) {
        return Effect.fail(new Error('No mutation response configured')) as any;
      }
      if (response instanceof Error) {
        return Effect.fail(response) as any;
      }
      return Effect.succeed(response) as any;
    },
    action: () => Effect.die('action not implemented in test backend') as any,
  });
}

interface EnvServiceConfig {
  isAuthenticated?: boolean;
  authFilePath?: string;
  sessionId?: string | null;
  deviceName?: string;
  cliVersion?: string;
  saveAuthDataError?: Error;
  env?: Record<string, string | undefined>;
  openBrowserFn?: (url: string) => void;
  nowValue?: number;
  delayFn?: () => void;
}

/** Create a test AuthLoginEnvService with configurable responses. */
function makeTestEnvService(config: EnvServiceConfig = {}) {
  const savedAuthData: unknown[] = [];
  const openedUrls: string[] = [];
  const writtenText: string[] = [];

  const nowValue = config.nowValue ?? Date.now();

  const layer = Layer.succeed(AuthLoginEnvService, {
    isAuthenticated: () => Effect.succeed(config.isAuthenticated ?? false),
    getAuthFilePath: () => Effect.succeed(config.authFilePath ?? '/test/.chatroom/auth.json'),
    saveAuthData: (data) => {
      if (config.saveAuthDataError) {
        return Effect.fail(config.saveAuthDataError);
      }
      savedAuthData.push(data);
      return Effect.succeed(undefined as void);
    },
    getDeviceName: () => Effect.succeed(config.deviceName ?? 'test-device (darwin)'),
    getCliVersion: () => Effect.succeed(config.cliVersion ?? '1.0.0-test'),
    getSessionId: () =>
      Effect.succeed(
        config.sessionId !== undefined ? (config.sessionId as unknown as SessionId | null) : null
      ),
    openBrowser: (url) => {
      config.openBrowserFn?.(url);
      openedUrls.push(url);
      return Effect.succeed(undefined as void);
    },
    now: () => Effect.succeed(nowValue),
    delay: () => {
      config.delayFn?.();
      return Effect.succeed(undefined as void);
    },
    env: () => Effect.succeed(config.env ?? { CHATROOM_WEB_URL: 'http://localhost:3000' }),
    stdoutWrite: (text) => {
      writtenText.push(text);
      return Effect.succeed(undefined as void);
    },
  });

  return { layer, savedAuthData, openedUrls, writtenText };
}

/** Helper: extract a typed error from a Failure exit. */
function extractError<E>(exit: Exit.Exit<unknown, E>): E | null {
  if (exit._tag !== 'Failure') return null;
  const option = Cause.failureOption(exit.cause);
  return option._tag === 'Some' ? option.value : null;
}

// ---------------------------------------------------------------------------
// Default happy-path test layer
// ---------------------------------------------------------------------------

const DEFAULT_AUTH_REQUEST = {
  requestId: 'req-test-123',
  expiresAt: Date.now() + 60_000,
};

const APPROVED_STATUS = { status: 'approved', sessionId: 'sess-approved' };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('authLoginEffect', () => {
  test('succeeds on first poll when session is immediately approved', async () => {
    const { layer: envLayer, savedAuthData, openedUrls } = makeTestEnvService();
    const backendLayer = makeTestBackend({
      mutationResponse: DEFAULT_AUTH_REQUEST,
      queryResponses: [APPROVED_STATUS],
    });

    const testLayer = Layer.mergeAll(backendLayer, envLayer);
    const exit = await Effect.runPromiseExit(authLoginEffect({}).pipe(Effect.provide(testLayer)));

    expect(exit._tag).toBe('Success');
    expect(openedUrls).toHaveLength(1);
    expect(openedUrls[0]).toContain('/cli-auth?request=req-test-123');
    expect(savedAuthData).toHaveLength(1);
    expect((savedAuthData[0] as any).sessionId).toBe('sess-approved');
  });

  test('succeeds after N polls — approved on 3rd attempt', async () => {
    const { layer: envLayer, savedAuthData } = makeTestEnvService();
    const backendLayer = makeTestBackend({
      mutationResponse: DEFAULT_AUTH_REQUEST,
      queryResponses: [
        { status: 'pending' },
        { status: 'pending' },
        { status: 'approved', sessionId: 'sess-delayed' },
      ],
    });

    const testLayer = Layer.mergeAll(backendLayer, envLayer);
    const exit = await Effect.runPromiseExit(authLoginEffect({}).pipe(Effect.provide(testLayer)));

    expect(exit._tag).toBe('Success');
    expect(savedAuthData).toHaveLength(1);
    expect((savedAuthData[0] as any).sessionId).toBe('sess-delayed');
  });

  test('short-circuits with AlreadyAuthenticated when already logged in and force=false', async () => {
    const { layer: envLayer } = makeTestEnvService({
      isAuthenticated: true,
      sessionId: 'existing-session',
    });

    // validateSession returns valid
    const backendLayer = makeTestBackend({
      queryResponses: [{ valid: true, userId: 'user-1' }],
    });

    const testLayer = Layer.mergeAll(backendLayer, envLayer);
    const exit = await Effect.runPromiseExit(
      authLoginEffect({ force: false }).pipe(Effect.provide(testLayer))
    );

    expect(exit._tag).toBe('Failure');
    const err = extractError<AuthLoginError>(exit as any);
    expect(err?._tag).toBe('AlreadyAuthenticated');
  });

  test('allows re-login when force=true even if already authenticated', async () => {
    const { layer: envLayer, savedAuthData } = makeTestEnvService({
      isAuthenticated: true,
      sessionId: 'existing-session',
    });

    // With force=true, validateSession is NOT called; only mutation + poll
    const backendLayer = makeTestBackend({
      mutationResponse: DEFAULT_AUTH_REQUEST,
      queryResponses: [APPROVED_STATUS],
    });

    const testLayer = Layer.mergeAll(backendLayer, envLayer);
    const exit = await Effect.runPromiseExit(
      authLoginEffect({ force: true }).pipe(Effect.provide(testLayer))
    );

    expect(exit._tag).toBe('Success');
    // New auth data was saved, confirming the flow ran through
    expect(savedAuthData).toHaveLength(1);
  });

  test('short-circuits with AlreadyAuthenticated when backend unreachable (trusts local file)', async () => {
    const { layer: envLayer } = makeTestEnvService({
      isAuthenticated: true,
      sessionId: 'existing-session',
    });

    const backendLayer = makeTestBackend({
      queryResponses: [new Error('ECONNREFUSED')],
    });

    const testLayer = Layer.mergeAll(backendLayer, envLayer);
    const exit = await Effect.runPromiseExit(
      authLoginEffect({ force: false }).pipe(Effect.provide(testLayer))
    );

    expect(exit._tag).toBe('Failure');
    const err = extractError<AuthLoginError>(exit as any);
    expect(err?._tag).toBe('AlreadyAuthenticated');
  });

  test('fails with DeviceSessionCreateFailed when createAuthRequest mutation throws', async () => {
    const { layer: envLayer } = makeTestEnvService();
    const backendLayer = makeTestBackend({
      mutationResponse: new Error('Backend unavailable'),
    });

    const testLayer = Layer.mergeAll(backendLayer, envLayer);
    const exit = await Effect.runPromiseExit(authLoginEffect({}).pipe(Effect.provide(testLayer)));

    expect(exit._tag).toBe('Failure');
    const err = extractError<AuthLoginError>(exit as any);
    expect(err?._tag).toBe('DeviceSessionCreateFailed');
    if (err?._tag === 'DeviceSessionCreateFailed') {
      expect(err.cause.message).toBe('Backend unavailable');
    }
  });

  test('fails with LoginTimeout when polling never confirms (max polls reached)', async () => {
    const now = Date.now();
    // expiresAt is only 1000ms away → maxPolls = ceil(1000/2000) = 1
    const { layer: envLayer } = makeTestEnvService({ nowValue: now });
    const backendLayer = makeTestBackend({
      mutationResponse: { requestId: 'req-short', expiresAt: now + 1000 },
      // Always return pending — will hit maxPolls=1 after 1 poll
      queryResponses: [{ status: 'pending' }],
    });

    const testLayer = Layer.mergeAll(backendLayer, envLayer);
    const exit = await Effect.runPromiseExit(authLoginEffect({}).pipe(Effect.provide(testLayer)));

    expect(exit._tag).toBe('Failure');
    const err = extractError<AuthLoginError>(exit as any);
    expect(err?._tag).toBe('LoginTimeout');
  });

  test('fails with LoginTimeout when authorization is denied', async () => {
    const { layer: envLayer } = makeTestEnvService();
    const backendLayer = makeTestBackend({
      mutationResponse: DEFAULT_AUTH_REQUEST,
      queryResponses: [{ status: 'denied' }],
    });

    const testLayer = Layer.mergeAll(backendLayer, envLayer);
    const exit = await Effect.runPromiseExit(authLoginEffect({}).pipe(Effect.provide(testLayer)));

    expect(exit._tag).toBe('Failure');
    const err = extractError<AuthLoginError>(exit as any);
    expect(err?._tag).toBe('LoginTimeout');
  });

  test('fails with LoginTimeout when authorization request expires', async () => {
    const { layer: envLayer } = makeTestEnvService();
    const backendLayer = makeTestBackend({
      mutationResponse: DEFAULT_AUTH_REQUEST,
      queryResponses: [{ status: 'expired' }],
    });

    const testLayer = Layer.mergeAll(backendLayer, envLayer);
    const exit = await Effect.runPromiseExit(authLoginEffect({}).pipe(Effect.provide(testLayer)));

    expect(exit._tag).toBe('Failure');
    const err = extractError<AuthLoginError>(exit as any);
    expect(err?._tag).toBe('LoginTimeout');
  });

  test('fails with SaveFailed when saveAuthData throws', async () => {
    const { layer: envLayer } = makeTestEnvService({
      saveAuthDataError: new Error('Disk full'),
    });
    const backendLayer = makeTestBackend({
      mutationResponse: DEFAULT_AUTH_REQUEST,
      queryResponses: [APPROVED_STATUS],
    });

    const testLayer = Layer.mergeAll(backendLayer, envLayer);
    const exit = await Effect.runPromiseExit(authLoginEffect({}).pipe(Effect.provide(testLayer)));

    expect(exit._tag).toBe('Failure');
    const err = extractError<AuthLoginError>(exit as any);
    expect(err?._tag).toBe('SaveFailed');
    if (err?._tag === 'SaveFailed') {
      expect(err.cause.message).toBe('Disk full');
    }
  });

  test('continues polling after a transient network error during poll', async () => {
    const { layer: envLayer, savedAuthData } = makeTestEnvService();
    const backendLayer = makeTestBackend({
      mutationResponse: DEFAULT_AUTH_REQUEST,
      queryResponses: [
        new Error('Network timeout'), // poll 1 fails
        APPROVED_STATUS, // poll 2 succeeds
      ],
    });

    const testLayer = Layer.mergeAll(backendLayer, envLayer);
    const exit = await Effect.runPromiseExit(authLoginEffect({}).pipe(Effect.provide(testLayer)));

    expect(exit._tag).toBe('Success');
    expect(savedAuthData).toHaveLength(1);
  });
});
