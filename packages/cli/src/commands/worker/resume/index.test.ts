import { describe, it, expect, vi, beforeEach } from 'vitest';
import { workerResume } from './index.js';
import type { WorkerResumeDeps } from './index.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createMockHandle() {
  return {
    workerId: 'worker-abc',
    harnessSessionId: 'harness-xyz',
    session: { send: vi.fn(), onEvent: vi.fn(() => () => {}), close: vi.fn() } as any,
    close: vi.fn(),
  };
}

function createDeps(overrides: Partial<WorkerResumeDeps> = {}): WorkerResumeDeps {
  const resumeWorkerImpl = vi.fn().mockResolvedValue(createMockHandle());
  const lines: string[] = [];
  return {
    backend: {
      mutation: vi.fn().mockResolvedValue(undefined),
      query: vi.fn().mockResolvedValue(undefined),
    },
    session: { getSessionId: vi.fn().mockReturnValue('session-abc') },
    harnessFactory: vi.fn().mockReturnValue({ harnessName: 'opencode-sdk', spawn: vi.fn(), resume: vi.fn() }),
    stdout: (line: string) => lines.push(line),
    resumeWorkerImpl,
    ...overrides,
    _lines: lines,
    _resumeWorkerImpl: resumeWorkerImpl,
  } as any;
}

const VALID_OPTIONS = {
  workerId: 'worker-abc',
  harnessSessionId: 'harness-xyz',
  harness: 'opencode-sdk',
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('workerResume', () => {
  beforeEach(() => {
    vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
  });

  it('exits with error when session is missing', async () => {
    const deps = createDeps({
      session: { getSessionId: vi.fn().mockReturnValue(null) },
    });
    await expect(workerResume(VALID_OPTIONS, deps)).rejects.toThrow('exit');
  });

  it('calls harnessFactory with the specified harness name', async () => {
    const deps = createDeps();
    await expect(workerResume(VALID_OPTIONS, deps)).rejects.toThrow('exit');
    expect((deps as any).harnessFactory).toHaveBeenCalledWith('opencode-sdk');
  });

  it('prints resumed confirmation to stdout', async () => {
    const deps = createDeps();
    await expect(workerResume(VALID_OPTIONS, deps)).rejects.toThrow('exit');
    const lines = (deps as any)._lines;
    expect(lines.join('\n')).toContain('resumed workerId: worker-abc');
    expect(lines.join('\n')).toContain('harnessSessionId: harness-xyz');
  });

  it('passes workerId and harnessSessionId to resumeWorker', async () => {
    const deps = createDeps();
    await expect(workerResume(VALID_OPTIONS, deps)).rejects.toThrow('exit');
    const [, resumeOptions] = (deps as any)._resumeWorkerImpl.mock.calls[0];
    expect(resumeOptions.workerId).toBe('worker-abc');
    expect(resumeOptions.harnessSessionId).toBe('harness-xyz');
  });
});
