/**
 * Local API Router — Unit Tests
 *
 * Tests route registration, dispatch, OPTIONS handling, 404 responses,
 * and CORS header injection.
 */

import { describe, expect, test, vi } from 'vitest';

import { LocalApiRouter } from './router.js';
import type { DaemonContext, LocalApiRequest, LocalApiResponse } from './types.js';

// ─── Test Helpers ─────────────────────────────────────────────────────────────

function makeCtx(): DaemonContext {
  return {
    machineId: 'test-machine-id',
    config: { hostname: 'test-host', os: 'linux' } as DaemonContext['config'],
  } as unknown as DaemonContext;
}

function makeReq(overrides: Partial<LocalApiRequest> = {}): LocalApiRequest {
  return {
    method: 'GET',
    url: '/api/test',
    headers: {},
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('LocalApiRouter', () => {
  test('dispatches a matching GET route', async () => {
    const router = new LocalApiRouter();
    const handler = vi.fn().mockResolvedValue({
      status: 200,
      body: JSON.stringify({ ok: true }),
    } satisfies LocalApiResponse);

    router.registerRoute({ method: 'GET', path: '/api/test', handler });

    const res = await router.handleRequest(makeReq(), makeCtx());

    expect(handler).toHaveBeenCalledOnce();
    expect(res.status).toBe(200);
  });

  test('returns 404 for unmatched paths', async () => {
    const router = new LocalApiRouter();
    const res = await router.handleRequest(makeReq({ url: '/api/unknown' }), makeCtx());
    expect(res.status).toBe(404);
  });

  test('returns 404 when method does not match', async () => {
    const router = new LocalApiRouter();
    router.registerRoute({
      method: 'POST',
      path: '/api/test',
      handler: async () => ({ status: 200, body: 'ok' }),
    });

    const res = await router.handleRequest(makeReq({ method: 'GET', url: '/api/test' }), makeCtx());
    expect(res.status).toBe(404);
  });

  test('returns 204 with CORS headers for OPTIONS preflight', async () => {
    const router = new LocalApiRouter();
    const res = await router.handleRequest(makeReq({ method: 'OPTIONS' }), makeCtx());
    expect(res.status).toBe(204);
    expect(res.headers?.['Access-Control-Allow-Origin']).toBe('*');
    expect(res.headers?.['Access-Control-Allow-Methods']).toContain('GET');
  });

  test('applies CORS headers to all responses', async () => {
    const router = new LocalApiRouter();
    router.registerRoute({
      method: 'GET',
      path: '/api/test',
      handler: async () => ({ status: 200, body: 'ok' }),
    });

    const res = await router.handleRequest(makeReq(), makeCtx());
    expect(res.headers?.['Access-Control-Allow-Origin']).toBe('*');
  });

  test('applies CORS headers even to 404 responses', async () => {
    const router = new LocalApiRouter();
    const res = await router.handleRequest(makeReq({ url: '/nope' }), makeCtx());
    expect(res.headers?.['Access-Control-Allow-Origin']).toBe('*');
  });

  test('returns 500 when a handler throws', async () => {
    const router = new LocalApiRouter();
    router.registerRoute({
      method: 'GET',
      path: '/api/test',
      handler: async () => {
        throw new Error('boom');
      },
    });

    const res = await router.handleRequest(makeReq(), makeCtx());
    expect(res.status).toBe(500);
  });

  test('preserves existing response headers while adding CORS headers', async () => {
    const router = new LocalApiRouter();
    router.registerRoute({
      method: 'GET',
      path: '/api/test',
      handler: async () => ({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      }),
    });

    const res = await router.handleRequest(makeReq(), makeCtx());
    expect(res.headers?.['Content-Type']).toBe('application/json');
    expect(res.headers?.['Access-Control-Allow-Origin']).toBe('*');
  });

  test('first registered route wins when multiple routes match', async () => {
    const router = new LocalApiRouter();
    router.registerRoute({
      method: 'GET',
      path: '/api/test',
      handler: async () => ({ status: 200, body: 'first' }),
    });
    router.registerRoute({
      method: 'GET',
      path: '/api/test',
      handler: async () => ({ status: 200, body: 'second' }),
    });

    const res = await router.handleRequest(makeReq(), makeCtx());
    expect(res.body).toBe('first');
  });

  test('matches route ignoring query parameters', async () => {
    const router = new LocalApiRouter();
    router.registerRoute({
      method: 'GET',
      path: '/api/test',
      handler: async () => ({ status: 200, body: 'matched' }),
    });

    const res = await router.handleRequest(
      makeReq({ url: '/api/test?foo=bar&baz=1' }),
      makeCtx()
    );
    expect(res.status).toBe(200);
    expect(res.body).toBe('matched');
  });
});
