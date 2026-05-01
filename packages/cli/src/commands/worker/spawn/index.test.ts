import { describe, it, expect, vi, beforeEach } from 'vitest';
import { workerSpawn } from './index.js';
import type { WorkerSpawnDeps } from './index.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createMockHandle() {
  return {
    workerId: 'worker-123',
    harnessSessionId: 'harness-session-456',
    session: { send: vi.fn(), onEvent: vi.fn(() => () => {}), close: vi.fn() } as any,
    close: vi.fn(),
  };
}

function createDeps(overrides: Partial<WorkerSpawnDeps> = {}): WorkerSpawnDeps {
  const spawnWorkerImpl = vi.fn().mockResolvedValue(createMockHandle());
  const lines: string[] = [];
  return {
    backend: {
      mutation: vi.fn().mockResolvedValue(undefined),
      query: vi.fn().mockResolvedValue(undefined),
    },
    session: { getSessionId: vi.fn().mockReturnValue('session-abc') },
    harnessFactory: vi.fn().mockReturnValue({ harnessName: 'opencode-sdk', spawn: vi.fn(), resume: vi.fn() }),
    stdout: (line: string) => lines.push(line),
    spawnWorkerImpl,
    ...overrides,
    // Expose lines for assertions
    _lines: lines,
    _spawnWorkerImpl: spawnWorkerImpl,
  } as any;
}

const VALID_OPTIONS = { chatroomId: 'room-1', role: 'builder', harness: 'opencode-sdk' };

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('workerSpawn', () => {
  beforeEach(() => {
    vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
  });

  it('exits with error when session is missing', async () => {
    const deps = createDeps({
      session: { getSessionId: vi.fn().mockReturnValue(null) },
    });
    await expect(workerSpawn(VALID_OPTIONS, deps)).rejects.toThrow('exit');
  });

  it('calls harnessFactory with the specified harness name', async () => {
    const deps = createDeps();
    await expect(workerSpawn(VALID_OPTIONS, deps)).rejects.toThrow('exit'); // process.exit
    expect((deps as any).harnessFactory).toHaveBeenCalledWith('opencode-sdk');
  });

  it('uses opencode-sdk as the default harness', async () => {
    const deps = createDeps();
    await expect(workerSpawn({ chatroomId: 'r', role: 'b' }, deps)).rejects.toThrow('exit');
    expect((deps as any).harnessFactory).toHaveBeenCalledWith('opencode-sdk');
  });

  it('prints workerId and harnessSessionId to stdout', async () => {
    const deps = createDeps();
    await expect(workerSpawn(VALID_OPTIONS, deps)).rejects.toThrow('exit');
    const lines = (deps as any)._lines;
    expect(lines).toContain('workerId: worker-123');
    expect(lines).toContain('harnessSessionId: harness-session-456');
  });

  it('passes chatroomId and role to spawnWorker', async () => {
    const deps = createDeps();
    await expect(workerSpawn(VALID_OPTIONS, deps)).rejects.toThrow('exit');
    const [, spawnOptions] = (deps as any)._spawnWorkerImpl.mock.calls[0];
    expect(spawnOptions.chatroomId).toBe('room-1');
    expect(spawnOptions.role).toBe('builder');
  });

  it('does NOT call worker.close() — worker runs detached', async () => {
    const handle = createMockHandle();
    const deps = createDeps({
      spawnWorkerImpl: vi.fn().mockResolvedValue(handle),
    });
    await expect(workerSpawn(VALID_OPTIONS, deps)).rejects.toThrow('exit');
    expect(handle.close).not.toHaveBeenCalled();
  });
});
