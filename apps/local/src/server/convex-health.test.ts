import { describe, it, expect, beforeEach, vi } from 'vitest';

import { checkConvexHealth, waitForConvexHealthy } from './convex-health.js';

const CONVEX_URL = 'http://127.0.0.1:3210';

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('checkConvexHealth', () => {
  it('returns ok on 200', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok', { status: 200 }));
    const result = await checkConvexHealth(CONVEX_URL);
    expect(result).toEqual({ ok: true });
  });

  it('returns not-ok on non-200', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('not found', { status: 404 }));
    const result = await checkConvexHealth(CONVEX_URL);
    expect(result).toEqual({ ok: false, reason: 'HTTP 404' });
  });

  it('returns not-ok on network error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));
    const result = await checkConvexHealth(CONVEX_URL);
    expect(result).toEqual({ ok: false, reason: 'ECONNREFUSED' });
  });

  it('returns not-ok on timeout', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      (_url: RequestInfo | URL, init?: RequestInit) =>
        new Promise<never>((_, reject) => {
          const signal = init?.signal as AbortSignal | undefined;
          if (signal) {
            signal.addEventListener('abort', () => reject(new Error('Aborted')), { once: true });
          }
        })
    );
    const result = await checkConvexHealth(CONVEX_URL, 100);
    expect(result.ok).toBe(false);
  });
});

describe('waitForConvexHealthy', () => {
  it('returns ok when convex becomes healthy', async () => {
    const mock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('not ready', { status: 503 }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    const result = await waitForConvexHealthy(CONVEX_URL, {
      intervalMs: 10,
      maxAttempts: 10,
    });
    expect(result).toEqual({ ok: true });
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it('returns not-ok after max attempts with last HTTP reason', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('not ready', { status: 503 }));
    const result = await waitForConvexHealthy(CONVEX_URL, {
      intervalMs: 10,
      maxAttempts: 3,
    });
    expect(result).toEqual({ ok: false, reason: 'HTTP 503' });
  });
});
