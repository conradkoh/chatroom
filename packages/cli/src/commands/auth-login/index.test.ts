/**
 * auth-login Unit Tests
 *
 * Tests the authLogin command with all external dependencies injected.
 * Browser, auth storage, backend, clock, and process are all stubbed
 * so the tests run without network calls or browser launches.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import type { AuthLoginDeps } from './deps.js';
import { authLogin, getWebAppUrl } from './index.js';
import { getConvexUrl } from '../../infrastructure/convex/client.js';

// ---------------------------------------------------------------------------
// Module Mocks — getConvexUrl is a module-level import used by getWebAppUrl
// ---------------------------------------------------------------------------

vi.mock('../../infrastructure/convex/client.js', () => ({
  getConvexUrl: vi.fn().mockReturnValue('http://localhost:3210'),
  getConvexClient: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockDeps(overrides?: Partial<AuthLoginDeps>): AuthLoginDeps {
  return {
    backend: {
      mutation: vi.fn().mockResolvedValue({
        requestId: 'req-abc-123',
        expiresAt: Date.now() + 60_000,
      }),
      query: vi.fn().mockResolvedValue({
        status: 'approved',
        sessionId: 'session-xyz',
      }),
    },
    auth: {
      isAuthenticated: vi.fn().mockReturnValue(false),
      getAuthFilePath: vi.fn().mockReturnValue('/home/user/.chatroom/auth.json'),
      saveAuthData: vi.fn(),
      getDeviceName: vi.fn().mockReturnValue('test-host (darwin)'),
      getCliVersion: vi.fn().mockReturnValue('1.0.0-test'),
    },
    browser: {
      open: vi.fn().mockResolvedValue(undefined),
    },
    clock: {
      now: vi.fn().mockReturnValue(Date.now()),
      delay: vi.fn().mockResolvedValue(undefined),
    },
    process: {
      env: { CHATROOM_WEB_URL: 'http://localhost:3000' },
      platform: 'darwin',
      exit: vi.fn(),
      stdoutWrite: vi.fn().mockReturnValue(true),
    },
    ...overrides,
  };
}

let logSpy: any;

let errorSpy: any;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getConvexUrl).mockReturnValue('http://localhost:3210');
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

function getAllLogOutput(): string {
  return logSpy.mock.calls.map((c: string[]) => c.join(' ')).join('\n');
}

function getAllErrorOutput(): string {
  return errorSpy.mock.calls.map((c: string[]) => c.join(' ')).join('\n');
}

// ---------------------------------------------------------------------------
// getWebAppUrl
// ---------------------------------------------------------------------------

describe('getWebAppUrl', () => {
  it('returns production webapp URL for production Convex URL', () => {
    vi.mocked(getConvexUrl).mockReturnValue('https://chatroom-cloud.duskfare.com');
    const deps = createMockDeps();

    const url = getWebAppUrl(deps);

    expect(url).toBe('https://chatroom.duskfare.com');
  });

  it('returns CHATROOM_WEB_URL for non-production Convex URL', () => {
    const deps = createMockDeps({
      process: {
        ...createMockDeps().process,
        env: { CHATROOM_WEB_URL: 'http://my-dev:4000' },
      },
    });

    const url = getWebAppUrl(deps);

    expect(url).toBe('http://my-dev:4000');
  });

  it('exits with error when non-production and CHATROOM_WEB_URL not set', () => {
    const deps = createMockDeps({
      process: {
        ...createMockDeps().process,
        env: {},
      },
    });

    getWebAppUrl(deps);

    expect(deps.process.exit).toHaveBeenCalledWith(1);
    expect(getAllErrorOutput()).toContain('CHATROOM_WEB_URL Required');
  });
});

// ---------------------------------------------------------------------------
// authLogin — early exit paths
// ---------------------------------------------------------------------------

describe('authLogin', () => {
  it('returns early when already authenticated and force is false', async () => {
    const deps = createMockDeps({
      auth: {
        ...createMockDeps().auth,
        isAuthenticated: vi.fn().mockReturnValue(true),
      },
    });

    await authLogin({ force: false }, deps);

    expect(getAllLogOutput()).toContain('Already authenticated');
    expect(deps.backend.mutation).not.toHaveBeenCalled();
  });

  it('proceeds when already authenticated but force is true', async () => {
    const deps = createMockDeps({
      auth: {
        ...createMockDeps().auth,
        isAuthenticated: vi.fn().mockReturnValue(true),
      },
    });

    await authLogin({ force: true }, deps);

    // Should proceed to create an auth request
    expect(deps.backend.mutation).toHaveBeenCalled();
  });

  it('proceeds when not authenticated', async () => {
    const deps = createMockDeps();

    await authLogin({}, deps);

    expect(deps.backend.mutation).toHaveBeenCalled();
  });

  // ─── Full login flow ───────────────────────────────────────────────

  it('creates auth request, opens browser, and polls for approval', async () => {
    const deps = createMockDeps();

    await authLogin({}, deps);

    // 1. Created auth request
    expect(deps.backend.mutation).toHaveBeenCalledTimes(1);

    // 2. Opened browser with auth URL
    expect(deps.browser.open).toHaveBeenCalledTimes(1);
    const browserUrl = vi.mocked(deps.browser.open).mock.calls[0]?.[0];
    expect(browserUrl).toContain('/cli-auth?request=req-abc-123');

    // 3. Polled for status
    expect(deps.backend.query).toHaveBeenCalledTimes(1);

    // 4. Saved auth data
    expect(deps.auth.saveAuthData).toHaveBeenCalledTimes(1);
    expect(deps.auth.saveAuthData).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-xyz',
        deviceName: 'test-host (darwin)',
        cliVersion: '1.0.0-test',
      })
    );

    // 5. Logged success
    expect(getAllLogOutput()).toContain('AUTHENTICATION SUCCESSFUL');
  });

  it('polls multiple times until approved', async () => {
    const deps = createMockDeps();
    // First 2 polls return pending, third returns approved
    vi.mocked(deps.backend.query)
      .mockResolvedValueOnce({ status: 'pending' })
      .mockResolvedValueOnce({ status: 'pending' })
      .mockResolvedValueOnce({ status: 'approved', sessionId: 'session-delayed' });

    await authLogin({}, deps);

    expect(deps.backend.query).toHaveBeenCalledTimes(3);
    expect(deps.clock.delay).toHaveBeenCalledTimes(2); // 2 delays between 3 polls
    expect(deps.auth.saveAuthData).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'session-delayed' })
    );
  });

  it('exits when authorization is denied', async () => {
    const deps = createMockDeps();
    vi.mocked(deps.backend.query).mockResolvedValueOnce({ status: 'denied' });

    await authLogin({}, deps);

    expect(deps.process.exit).toHaveBeenCalledWith(1);
    expect(getAllLogOutput()).toContain('Authorization denied');
    expect(deps.auth.saveAuthData).not.toHaveBeenCalled();
  });

  it('exits when authorization expires', async () => {
    const deps = createMockDeps();
    vi.mocked(deps.backend.query).mockResolvedValueOnce({ status: 'expired' });

    await authLogin({}, deps);

    expect(deps.process.exit).toHaveBeenCalledWith(1);
    expect(getAllLogOutput()).toContain('Authorization request expired');
    expect(deps.auth.saveAuthData).not.toHaveBeenCalled();
  });

  it('exits when auth request is not found', async () => {
    const deps = createMockDeps();
    vi.mocked(deps.backend.query).mockResolvedValueOnce({ status: 'not_found' });

    await authLogin({}, deps);

    expect(deps.process.exit).toHaveBeenCalledWith(1);
    expect(getAllLogOutput()).toContain('Authorization request expired');
  });

  it('exits when max polls reached', async () => {
    const now = Date.now();
    const deps = createMockDeps();
    // expiresAt is very close (only 1 poll allowed: ceil((expiresAt - now) / 2000) = 1)
    vi.mocked(deps.backend.mutation).mockResolvedValue({
      requestId: 'req-short',
      expiresAt: now + 1000,
    });
    vi.mocked(deps.clock.now).mockReturnValue(now);
    // Always return pending
    vi.mocked(deps.backend.query).mockResolvedValue({ status: 'pending' });

    await authLogin({}, deps);

    expect(deps.process.exit).toHaveBeenCalledWith(1);
    expect(getAllLogOutput()).toContain('Authorization request expired');
  });

  it('handles poll errors gracefully and continues', async () => {
    const deps = createMockDeps();
    // First poll throws, second succeeds
    vi.mocked(deps.backend.query)
      .mockRejectedValueOnce(new Error('Network timeout'))
      .mockResolvedValueOnce({ status: 'approved', sessionId: 'session-retry' });

    await authLogin({}, deps);

    expect(deps.backend.query).toHaveBeenCalledTimes(2);
    expect(deps.auth.saveAuthData).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'session-retry' })
    );
    expect(getAllErrorOutput()).toContain('Network timeout');
  });

  it('logs device info and CLI version', async () => {
    const deps = createMockDeps();

    await authLogin({}, deps);

    const logs = getAllLogOutput();
    expect(logs).toContain('test-host (darwin)');
    expect(logs).toContain('1.0.0-test');
  });

  it('shows custom environment info for non-production URL', async () => {
    const deps = createMockDeps();

    await authLogin({}, deps);

    const logs = getAllLogOutput();
    expect(logs).toContain('Environment: Custom');
    expect(logs).toContain('http://localhost:3210');
  });

  it('does not show custom environment info for production URL', async () => {
    vi.mocked(getConvexUrl).mockReturnValue('https://chatroom-cloud.duskfare.com');
    const deps = createMockDeps();

    await authLogin({}, deps);

    const logs = getAllLogOutput();
    expect(logs).not.toContain('Environment: Custom');
  });
});
