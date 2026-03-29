/**
 * Identity Route — Unit Tests
 *
 * Tests that GET /api/identity returns the correct machine identity fields
 * from the daemon context.
 */

import { describe, expect, test, vi } from 'vitest';

import { identityRoute } from './routes/identity.js';
import type { DaemonContext, LocalApiRequest } from './types.js';

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('../../../version.js', () => ({
  getVersion: () => '1.16.6',
}));

// ─── Test Helpers ─────────────────────────────────────────────────────────────

function makeCtx(overrides: Partial<DaemonContext> = {}): DaemonContext {
  return {
    machineId: 'abc-123',
    config: {
      hostname: 'my-macbook',
      os: 'darwin',
    } as DaemonContext['config'],
    ...overrides,
  } as unknown as DaemonContext;
}

function makeReq(): LocalApiRequest {
  return {
    method: 'GET',
    url: '/api/identity',
    headers: {},
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('GET /api/identity', () => {
  test('route is registered as GET /api/identity', () => {
    expect(identityRoute.method).toBe('GET');
    expect(identityRoute.path).toBe('/api/identity');
  });

  test('returns 200 with identity fields', async () => {
    const ctx = makeCtx();
    const res = await identityRoute.handler(makeReq(), ctx);

    expect(res.status).toBe(200);

    const body = JSON.parse(res.body);
    expect(body.machineId).toBe('abc-123');
    expect(body.hostname).toBe('my-macbook');
    expect(body.os).toBe('darwin');
    expect(body.version).toBe('1.16.6');
  });

  test('returns Content-Type: application/json', async () => {
    const res = await identityRoute.handler(makeReq(), makeCtx());
    expect(res.headers?.['Content-Type']).toBe('application/json');
  });

  test('returns "unknown" hostname when config is null', async () => {
    const ctx = makeCtx({ config: null });
    const res = await identityRoute.handler(makeReq(), ctx);
    const body = JSON.parse(res.body);
    expect(body.hostname).toBe('unknown');
  });

  test('returns "unknown" os when config is null', async () => {
    const ctx = makeCtx({ config: null });
    const res = await identityRoute.handler(makeReq(), ctx);
    const body = JSON.parse(res.body);
    expect(body.os).toBe('unknown');
  });

  test('returns the machineId from context', async () => {
    const ctx = makeCtx({ machineId: 'custom-machine-xyz' });
    const res = await identityRoute.handler(makeReq(), ctx);
    const body = JSON.parse(res.body);
    expect(body.machineId).toBe('custom-machine-xyz');
  });
});
