import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sessionResume } from './index.js';
import type { SessionResumeDeps } from './index.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createMockHandle() {
  return {
    harnessSessionRowId: 'session-row-abc',
    harnessSessionId: 'harness-session-xyz',
    session: { prompt: vi.fn(), onEvent: vi.fn(() => () => {}), close: vi.fn() } as any,
    close: vi.fn(),
  };
}

function createDeps(overrides: Partial<SessionResumeDeps> = {}): SessionResumeDeps & {
  _lines: string[];
  _resumeSessionImpl: ReturnType<typeof vi.fn>;
} {
  const resumeSessionImpl = vi.fn().mockResolvedValue(createMockHandle());
  const lines: string[] = [];
  return {
    backend: {
      mutation: vi.fn().mockResolvedValue(undefined),
    },
    sessionId: 'session-abc',
    spawner: { harnessName: 'opencode-sdk', openSession: vi.fn(), resumeSession: vi.fn() },
    chunkExtractor: () => null,
    stdout: (line: string) => lines.push(line),
    resumeSessionImpl,
    ...overrides,
    _lines: lines,
    _resumeSessionImpl: resumeSessionImpl,
  } as any;
}

const VALID_OPTIONS = {
  harnessSessionRowId: 'session-row-abc',
  harnessSessionId: 'harness-session-xyz',
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('sessionResume', () => {
  beforeEach(() => {
    vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
  });

  it('exits with error when not authenticated', async () => {
    vi.spyOn(await import('../../../infrastructure/auth/storage.js'), 'getSessionId').mockReturnValue(null as any);
    const deps = createDeps();
    await expect(sessionResume(VALID_OPTIONS, deps)).rejects.toThrow('exit');
  });

  it('prints resumed confirmation to stdout', async () => {
    vi.spyOn(await import('../../../infrastructure/auth/storage.js'), 'getSessionId').mockReturnValue('session-abc' as any);
    const deps = createDeps();
    await expect(sessionResume(VALID_OPTIONS, deps)).rejects.toThrow('exit');
    expect(deps._lines.join('\n')).toContain('resumed harnessSessionRowId: session-row-abc');
    expect(deps._lines.join('\n')).toContain('harnessSessionId: harness-session-xyz');
  });
});
