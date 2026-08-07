import { describe, it, expect, beforeEach, vi } from 'vitest';

import { checkHttpHealth, waitForHttpHealth } from './http-health.js';

const HEALTH_URL = 'http://127.0.0.1:3210/version';

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('checkHttpHealth', () => {
  it('returns ok on 200', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok', { status: 200 }));
    const result = await checkHttpHealth(HEALTH_URL);
    expect(result).toEqual({ ok: true });
  });

  it('returns not-ok on non-200', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('not found', { status: 404 }));
    const result = await checkHttpHealth(HEALTH_URL);
    expect(result).toEqual({ ok: false, reason: 'HTTP 404' });
  });

  it('returns not-ok on network error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));
    const result = await checkHttpHealth(HEALTH_URL);
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
    const result = await checkHttpHealth(HEALTH_URL, { timeoutMs: 100 });
    expect(result.ok).toBe(false);
  });
});

describe('waitForHttpHealth', () => {
  it('returns ok when endpoint becomes healthy', async () => {
    const mock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('not ready', { status: 503 }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    const result = await waitForHttpHealth(HEALTH_URL, {
      intervalMs: 10,
      maxAttempts: 10,
    });
    expect(result).toEqual({ ok: true });
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it('returns not-ok after max attempts with last HTTP reason', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('not ready', { status: 503 }));
    const result = await waitForHttpHealth(HEALTH_URL, {
      intervalMs: 10,
      maxAttempts: 3,
      timeoutReason: 'timed out waiting for Convex',
    });
    expect(result).toEqual({ ok: false, reason: 'HTTP 503' });
  });
});
