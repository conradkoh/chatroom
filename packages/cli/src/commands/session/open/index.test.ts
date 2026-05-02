import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sessionOpen } from './index.js';
import type { SessionOpenDeps } from './index.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createMockHandle() {
  return {
    harnessSessionRowId: 'session-row-123',
    harnessSessionId: 'harness-session-456',
    session: { prompt: vi.fn(), onEvent: vi.fn(() => () => {}), close: vi.fn() } as any,
    close: vi.fn(),
  };
}

function createDeps(overrides: Partial<SessionOpenDeps> = {}): SessionOpenDeps & {
  _lines: string[];
  _openSessionImpl: ReturnType<typeof vi.fn>;
} {
  const openSessionImpl = vi.fn().mockResolvedValue(createMockHandle());
  const lines: string[] = [];
  return {
    backend: {
      mutation: vi.fn().mockResolvedValue(undefined),
    },
    sessionId: 'session-abc',
    harnessRegistry: {
      getOrSpawn: vi.fn(),
      invalidate: vi.fn(),
      killAll: vi.fn(),
      size: 0,
    } as any,
    chunkExtractor: () => null,
    stdout: (line: string) => lines.push(line),
    openSessionImpl,
    ...overrides,
    _lines: lines,
    _openSessionImpl: openSessionImpl,
  } as any;
}

const VALID_OPTIONS = { workspaceId: 'ws-1', agent: 'builder' };

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('sessionOpen', () => {
  beforeEach(() => {
    vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
  });

  it('exits with error when not authenticated', async () => {
    // Simulate no session ID
    vi.spyOn(await import('../../../infrastructure/auth/storage.js'), 'getSessionId').mockReturnValue(null as any);
    const deps = createDeps();
    await expect(sessionOpen(VALID_OPTIONS, deps)).rejects.toThrow('exit');
  });

  it('prints harnessSessionRowId and harnessSessionId to stdout', async () => {
    vi.spyOn(await import('../../../infrastructure/auth/storage.js'), 'getSessionId').mockReturnValue('session-abc' as any);
    const deps = createDeps();

    // Mock workspace lookup to succeed
    (deps.backend as any).query = vi.fn().mockResolvedValue({ workingDir: '/tmp/ws1', _id: 'ws-1' });

    await expect(sessionOpen(VALID_OPTIONS, deps)).rejects.toThrow('exit');
    expect(deps._lines).toContain('harnessSessionRowId: session-row-123');
    expect(deps._lines).toContain('harnessSessionId: harness-session-456');
  });
});
