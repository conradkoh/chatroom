/**
 * requireAuth() Unit Tests
 *
 * Covers:
 * - Default fast-fail behaviour (unchanged for short-lived commands)
 * - Opt-in retryOnNetworkError mode: dedup logging + eventual success
 * - Custom retryIntervalMs honoured by fake timers
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { requireAuth, DEFAULT_AUTH_RETRY_INTERVAL_MS } from './middleware.js';
import { isAuthenticated, getSessionId } from './storage.js';
import { isNetworkError, formatConnectivityError } from '../../utils/error-formatting.js';
import { getConvexClient, getConvexUrl } from '../convex/client.js';

// ---------------------------------------------------------------------------
// Module Mocks — must be declared before imports that use them
// ---------------------------------------------------------------------------

vi.mock('./storage.js', () => ({
  isAuthenticated: vi.fn().mockReturnValue(true),
  getSessionId: vi.fn().mockReturnValue('session-test-123'),
  getAuthFilePath: vi.fn().mockReturnValue('/home/user/.chatroom/auth.json'),
  getOtherSessionUrls: vi.fn().mockReturnValue([]),
}));

vi.mock('../convex/client.js', () => ({
  getConvexUrl: vi.fn().mockReturnValue('http://localhost:3210'),
  getConvexClient: vi.fn().mockResolvedValue({
    query: vi.fn().mockResolvedValue({ valid: true, userId: 'user-1', userName: 'Test User' }),
    mutation: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('../../utils/error-formatting.js', () => ({
  isNetworkError: vi.fn().mockReturnValue(false),
  formatConnectivityError: vi.fn(),
}));

vi.mock('../../api.js', () => ({
  api: {
    cliAuth: {
      validateSession: 'cliAuth:validateSession',
      touchSession: 'cliAuth:touchSession',
    },
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getMockClient() {
  const client = await vi.mocked(getConvexClient)();
  return client as any as { query: ReturnType<typeof vi.fn>; mutation: ReturnType<typeof vi.fn> };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

 
let exitSpy: any;
 
let logSpy: any;
 
let errorSpy: any;

beforeEach(() => {
  vi.clearAllMocks();

  // Re-establish defaults
  vi.mocked(isAuthenticated).mockReturnValue(true);
  vi.mocked(getSessionId).mockReturnValue('session-test-123' as any);
  vi.mocked(getConvexUrl).mockReturnValue('http://localhost:3210');
  vi.mocked(isNetworkError).mockReturnValue(false);
  vi.mocked(getConvexClient).mockResolvedValue({
    query: vi.fn().mockResolvedValue({ valid: true, userId: 'user-1', userName: 'Test User' }),
    mutation: vi.fn().mockResolvedValue(undefined),
  } as any);

  exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Default (fast-fail) mode
// ---------------------------------------------------------------------------

describe('requireAuth() — default fast-fail mode', () => {
  it('returns AuthContext on successful validation', async () => {
    const ctx = await requireAuth();

    expect(ctx.sessionId).toBe('session-test-123');
    expect(ctx.userId).toBe('user-1');
    expect(ctx.userName).toBe('Test User');
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('exits when not authenticated locally', async () => {
    vi.mocked(isAuthenticated).mockReturnValue(false);

    await requireAuth();

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('exits when session ID is missing from auth file', async () => {
    vi.mocked(getSessionId).mockReturnValue(null as any);

    await requireAuth();

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('exits when session validation returns invalid', async () => {
    const client = await getMockClient();
    client.query.mockResolvedValueOnce({ valid: false, reason: 'Session expired' });

    await requireAuth();

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Session invalid'));
  });

  it('exits on network error (default fast-fail)', async () => {
    const networkError = new Error('fetch failed');
    vi.mocked(isNetworkError).mockReturnValue(true);
    const client = await getMockClient();
    client.query.mockRejectedValueOnce(networkError);

    await requireAuth();

    expect(formatConnectivityError).toHaveBeenCalledWith(networkError, 'http://localhost:3210');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('does NOT retry on network error in default mode', async () => {
    const networkError = new Error('fetch failed');
    vi.mocked(isNetworkError).mockReturnValue(true);
    const client = await getMockClient();
    // If it retried, query would be called more than once
    client.query.mockRejectedValue(networkError);

    await requireAuth();

    // Should have called query only once (no retry loop)
    expect(client.query).toHaveBeenCalledTimes(1);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

// ---------------------------------------------------------------------------
// Opt-in retry mode
// ---------------------------------------------------------------------------

describe('requireAuth({ retryOnNetworkError: true })', () => {
  it('does NOT exit on network error — retries and succeeds', async () => {
    vi.useFakeTimers();
    const networkError = new Error('fetch failed');
    vi.mocked(isNetworkError).mockReturnValue(true);
    const client = await getMockClient();

    // Fail once, then succeed
    client.query
      .mockRejectedValueOnce(networkError)
      .mockResolvedValueOnce({ valid: true, userId: 'user-1', userName: 'Test User' });

    const promise = requireAuth({ retryOnNetworkError: true });
    await vi.advanceTimersByTimeAsync(DEFAULT_AUTH_RETRY_INTERVAL_MS + 1);
    const ctx = await promise;

    expect(ctx).toBeDefined();
    expect(ctx.userId).toBe('user-1');
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('logs verbose block exactly once across N consecutive failures', async () => {
    vi.useFakeTimers();
    const networkError = new Error('fetch failed');
    vi.mocked(isNetworkError).mockReturnValue(true);
    const client = await getMockClient();

    // 3 failures then success
    client.query
      .mockRejectedValueOnce(networkError)
      .mockRejectedValueOnce(networkError)
      .mockRejectedValueOnce(networkError)
      .mockResolvedValueOnce({ valid: true, userId: 'user-1', userName: 'Test User' });

    const promise = requireAuth({ retryOnNetworkError: true });
    await vi.advanceTimersByTimeAsync(3 * DEFAULT_AUTH_RETRY_INTERVAL_MS + 1);
    await promise;

    // Verbose block must be logged exactly once (first failure only)
    expect(formatConnectivityError).toHaveBeenCalledTimes(1);
    expect(formatConnectivityError).toHaveBeenCalledWith(networkError, 'http://localhost:3210');

    // Subsequent failures produce concise lines
    const logLines = logSpy.mock.calls.map((c: unknown[]) => c.join(' ')).join('\n');
    const conciseCount = (logLines.match(/Backend still unreachable/g) ?? []).length;
    expect(conciseCount).toBe(2); // failures 2 and 3

    // Recovery line present
    expect(logLines).toContain('Backend reachable again');
  });

  it('logs a single recovery line on success after failures', async () => {
    vi.useFakeTimers();
    const networkError = new Error('fetch failed');
    vi.mocked(isNetworkError).mockReturnValue(true);
    const client = await getMockClient();

    client.query
      .mockRejectedValueOnce(networkError)
      .mockResolvedValueOnce({ valid: true, userId: 'user-1', userName: 'Test User' });

    const promise = requireAuth({ retryOnNetworkError: true });
    await vi.advanceTimersByTimeAsync(DEFAULT_AUTH_RETRY_INTERVAL_MS + 1);
    await promise;

    const logLines = logSpy.mock.calls.map((c: unknown[]) => c.join(' ')).join('\n');
    const recoveryCount = (logLines.match(/Backend reachable again/g) ?? []).length;
    expect(recoveryCount).toBe(1);
  });

  it('honours a custom retryIntervalMs', async () => {
    vi.useFakeTimers();
    const CUSTOM_INTERVAL = 5_000;
    const networkError = new Error('fetch failed');
    vi.mocked(isNetworkError).mockReturnValue(true);
    const client = await getMockClient();

    client.query
      .mockRejectedValueOnce(networkError)
      .mockResolvedValueOnce({ valid: true, userId: 'user-1', userName: 'Test User' });

    const promise = requireAuth({ retryOnNetworkError: true, retryIntervalMs: CUSTOM_INTERVAL });

    // Advance to just under the custom interval — should NOT have resolved yet
    await vi.advanceTimersByTimeAsync(CUSTOM_INTERVAL - 1);
    let resolved = false;
    void promise.then(() => {
      resolved = true;
    });
    await Promise.resolve();
    expect(resolved).toBe(false);

    // Cross the threshold
    await vi.advanceTimersByTimeAsync(1);
    const ctx = await promise;
    expect(ctx).toBeDefined();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('still exits on local auth failure even when retryOnNetworkError is true', async () => {
    vi.mocked(isAuthenticated).mockReturnValue(false);

    await requireAuth({ retryOnNetworkError: true });

    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
