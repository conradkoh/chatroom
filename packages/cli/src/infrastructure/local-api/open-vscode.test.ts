/**
 * Open VS Code Route — Unit Tests
 *
 * Tests POST /api/open-vscode route handler:
 * - Success case (workingDir exists, code CLI available)
 * - VS Code CLI not found
 * - Missing workingDir in body
 * - Non-existent directory
 * - Invalid JSON body
 */

import { describe, expect, test, vi, beforeEach } from 'vitest';

// ─── Test Helpers ─────────────────────────────────────────────────────────────

import type { LocalApiRequest } from './types.js';

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
const { openVSCodeRoute } = await import('./routes/open-vscode.js');

function makeReq(body?: object): LocalApiRequest {
  return {
    method: 'POST',
    url: '/api/open-vscode',
    headers: { 'content-type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  };
}

/**
 * Configure mockExec to simulate `which code` returning success or failure.
 * The first call to exec is `which code`, the second (if any) is the open command.
 */
function mockVSCodeCliAvailable(available: boolean): void {
  mockExec.mockImplementation((cmd: string, cb: (err: Error | null) => void) => {
    if (cmd.includes('which') || cmd.includes('where')) {
      cb(available ? null : new Error('not found'));
    } else {
      // The `code <path>` command — succeed
      cb(null);
    }
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('POST /api/open-vscode', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  test('route is registered as POST /api/open-vscode', () => {
    expect(openVSCodeRoute.method).toBe('POST');
    expect(openVSCodeRoute.path).toBe('/api/open-vscode');
  });

  test('returns success:true when code CLI is available and workingDir exists', async () => {
    mockAccess.mockResolvedValue(undefined);
    mockVSCodeCliAvailable(true);

    const res = await openVSCodeRoute.handler(makeReq({ workingDir: '/tmp/project' }), {} as never);

    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
  });

  test('calls exec with the workingDir path when code CLI is available', async () => {
    mockAccess.mockResolvedValue(undefined);
    mockVSCodeCliAvailable(true);

    await openVSCodeRoute.handler(makeReq({ workingDir: '/home/user/repo' }), {} as never);

    // Expect at least two exec calls: `which code` + `code <path>`
    expect(mockExec.mock.calls.length).toBeGreaterThanOrEqual(2);
    const openCall = mockExec.mock.calls.find(
      (c: unknown[]) => !(c[0] as string).includes('which') && !(c[0] as string).includes('where')
    );
    expect(openCall).toBeDefined();
    expect(openCall![0]).toContain('/home/user/repo');
  });

  test('returns success:false with VS Code not found error when code CLI is not available', async () => {
    mockAccess.mockResolvedValue(undefined);
    mockVSCodeCliAvailable(false);

    const res = await openVSCodeRoute.handler(makeReq({ workingDir: '/tmp/project' }), {} as never);

    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/VS Code CLI/);
    expect(body.error).toMatch(/code/);
  });

  test('returns success:false with error when workingDir is missing', async () => {
    const res = await openVSCodeRoute.handler(makeReq({}), {} as never);

    expect(res.status).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/workingDir/i);
  });

  test('returns success:false with error when workingDir is empty string', async () => {
    const res = await openVSCodeRoute.handler(makeReq({ workingDir: '' }), {} as never);

    expect(res.status).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(false);
  });

  test('returns success:false when directory does not exist', async () => {
    mockAccess.mockRejectedValue(new Error('ENOENT'));

    const res = await openVSCodeRoute.handler(makeReq({ workingDir: '/nonexistent/path' }), {} as never);

    expect(res.status).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/not found/i);
  });

  test('returns success:false with error for invalid JSON body', async () => {
    const req: LocalApiRequest = {
      method: 'POST',
      url: '/api/open-vscode',
      headers: {},
      body: '{invalid-json',
    };

    const res = await openVSCodeRoute.handler(req, {} as never);

    expect(res.status).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(false);
  });

  test('response has Content-Type: application/json', async () => {
    mockAccess.mockResolvedValue(undefined);
    mockVSCodeCliAvailable(true);

    const res = await openVSCodeRoute.handler(makeReq({ workingDir: '/tmp/x' }), {} as never);

    expect(res.headers?.['Content-Type']).toBe('application/json');
  });

  test('does not call exec with open command when CLI is not found', async () => {
    mockAccess.mockResolvedValue(undefined);
    mockVSCodeCliAvailable(false);

    await openVSCodeRoute.handler(makeReq({ workingDir: '/tmp/project' }), {} as never);

    // Should only have called exec once (the which/where check) — no open command
    expect(mockExec.mock.calls.length).toBe(1);
  });
});
