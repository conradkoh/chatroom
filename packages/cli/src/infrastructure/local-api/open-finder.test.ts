/**
 * Open Finder Route — Unit Tests
 *
 * Tests POST /api/open-finder route handler:
 * - Success case (workingDir exists)
 * - Missing workingDir in body
 * - Empty workingDir
 * - Non-existent directory
 * - Invalid JSON body
 * - Cross-platform command selection
 */

import { describe, expect, test, vi, beforeEach } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockExec = vi.fn();
const mockAccess = vi.fn();

vi.mock('node:child_process', () => ({
  exec: mockExec,
}));

vi.mock('node:fs/promises', () => ({
  access: mockAccess,
}));

// Import after mocks are set up
const { openFinderRoute } = await import('./routes/open-finder.js');

// ─── Test Helpers ─────────────────────────────────────────────────────────────

import type { LocalApiRequest } from './types.js';

function makeReq(body?: object): LocalApiRequest {
  return {
    method: 'POST',
    url: '/api/open-finder',
    headers: { 'content-type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('POST /api/open-finder', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  test('route is registered as POST /api/open-finder', () => {
    expect(openFinderRoute.method).toBe('POST');
    expect(openFinderRoute.path).toBe('/api/open-finder');
  });

  test('returns success:true when workingDir exists and exec is called', async () => {
    mockAccess.mockResolvedValue(undefined); // directory exists
    mockExec.mockImplementation((_cmd: string, cb: (err: null) => void) => cb(null));

    const res = await openFinderRoute.handler(makeReq({ workingDir: '/tmp/project' }), {} as never);

    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(mockAccess).toHaveBeenCalledWith('/tmp/project');
    expect(mockExec).toHaveBeenCalledOnce();
  });

  test('exec command contains the workingDir path', async () => {
    mockAccess.mockResolvedValue(undefined);
    mockExec.mockImplementation((_cmd: string, cb: (err: null) => void) => cb(null));

    await openFinderRoute.handler(makeReq({ workingDir: '/home/user/myproject' }), {} as never);

    const calledCommand = mockExec.mock.calls[0][0] as string;
    expect(calledCommand).toContain('/home/user/myproject');
  });

  test('returns success:false with error when workingDir is missing', async () => {
    const res = await openFinderRoute.handler(makeReq({}), {} as never);

    expect(res.status).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/workingDir/i);
  });

  test('returns success:false with error when workingDir is empty string', async () => {
    const res = await openFinderRoute.handler(makeReq({ workingDir: '' }), {} as never);

    expect(res.status).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(false);
  });

  test('returns success:false with error when workingDir is whitespace only', async () => {
    const res = await openFinderRoute.handler(makeReq({ workingDir: '   ' }), {} as never);

    expect(res.status).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(false);
  });

  test('returns success:false when directory does not exist', async () => {
    mockAccess.mockRejectedValue(new Error('ENOENT'));

    const res = await openFinderRoute.handler(makeReq({ workingDir: '/nonexistent/path' }), {} as never);

    expect(res.status).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/not found/i);
  });

  test('returns success:false with error for invalid JSON body', async () => {
    const req: LocalApiRequest = {
      method: 'POST',
      url: '/api/open-finder',
      headers: {},
      body: 'not-valid-json',
    };

    const res = await openFinderRoute.handler(req, {} as never);

    expect(res.status).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(false);
  });

  test('returns success:true even when exec reports an error (fire-and-forget)', async () => {
    mockAccess.mockResolvedValue(undefined);
    mockExec.mockImplementation((_cmd: string, cb: (err: Error) => void) => cb(new Error('exec failed')));

    // The route should still return 200 — exec errors are logged, not propagated
    const res = await openFinderRoute.handler(makeReq({ workingDir: '/tmp/project' }), {} as never);

    expect(res.status).toBe(200);
    expect(JSON.parse(res.body).success).toBe(true);
  });

  test('response has Content-Type: application/json', async () => {
    mockAccess.mockResolvedValue(undefined);
    mockExec.mockImplementation((_cmd: string, cb: (err: null) => void) => cb(null));

    const res = await openFinderRoute.handler(makeReq({ workingDir: '/tmp/x' }), {} as never);

    expect(res.headers?.['Content-Type']).toBe('application/json');
  });
});
