import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resumeWorker } from './resume-worker.js';
import type { ResumeWorkerDeps, ResumeWorkerOptions } from './resume-worker.js';
import type {
  DirectHarnessSpawner,
  DirectHarnessSession,
  DirectHarnessSessionEvent,
} from '../../domain/direct-harness/index.js';

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('../../api.js', () => ({
  api: {
    chatroom: {
      workers: {
        mutations: {
          createWorker: 'mock-createWorker',
          associateHarnessSession: 'mock-associateHarnessSession',
        },
      },
    },
  },
}));

vi.mock('../../infrastructure/services/direct-harness/message-stream/index.js', async () => {
  const real = await import('../../infrastructure/services/direct-harness/message-stream/index.js');
  return real;
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createMockSession(): DirectHarnessSession & { _triggerEvent: (e: DirectHarnessSessionEvent) => void } {
  const listeners = new Set<(e: DirectHarnessSessionEvent) => void>();
  return {
    harnessSessionId: 'harness-session-resume' as any,
    send: vi.fn().mockResolvedValue(undefined),
    onEvent: vi.fn((listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
    close: vi.fn().mockResolvedValue(undefined),
    _triggerEvent: (e: DirectHarnessSessionEvent) => {
      for (const l of listeners) l(e);
    },
  };
}

function createMockHarness(session: DirectHarnessSession): DirectHarnessSpawner {
  return {
    harnessName: 'test-harness',
    spawn: vi.fn().mockResolvedValue(session),
    resume: vi.fn().mockResolvedValue(session),
  };
}

function createDeps(sessionOverride?: DirectHarnessSession): ResumeWorkerDeps & {
  mutationFn: ReturnType<typeof vi.fn>;
  session: ReturnType<typeof createMockSession>;
  harness: DirectHarnessSpawner;
} {
  const session = sessionOverride ?? createMockSession();
  const mutationFn = vi.fn().mockResolvedValue(undefined);
  const harness = createMockHarness(session);
  const chunkExtractor = (e: DirectHarnessSessionEvent) =>
    e.type === 'message' ? String((e.payload as any)?.content ?? '') : null;

  return {
    backend: { mutation: mutationFn },
    sessionId: 'test-session',
    harness,
    chunkExtractor,
    nowFn: () => 0,
    mutationFn,
    session: session as any,
  };
}

const VALID_OPTIONS: ResumeWorkerOptions = {
  workerId: 'existing-worker-id',
  harnessSessionId: 'existing-harness-session',
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('resumeWorker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls harness.resume with the supplied harnessSessionId', async () => {
    const deps = createDeps();
    await resumeWorker(deps, VALID_OPTIONS);
    expect(deps.harness.resume).toHaveBeenCalledWith('existing-harness-session');
  });

  it('does NOT call createWorker or associateHarnessSession', async () => {
    const deps = createDeps();
    await resumeWorker(deps, VALID_OPTIONS);
    expect(deps.mutationFn).not.toHaveBeenCalled();
  });

  it('returns workerId matching the supplied id', async () => {
    const deps = createDeps();
    const handle = await resumeWorker(deps, VALID_OPTIONS);
    expect(handle.workerId).toBe('existing-worker-id');
  });

  it('returns harnessSessionId matching the supplied id', async () => {
    const deps = createDeps();
    const handle = await resumeWorker(deps, VALID_OPTIONS);
    expect(handle.harnessSessionId).toBe('existing-harness-session');
  });

  it('events flow through chunkExtractor when received from the resumed session', async () => {
    const session = createMockSession();
    const deps = createDeps(session);
    const chunkExtractorSpy = vi.fn(() => 'hello');
    const handle = await resumeWorker({ ...deps, chunkExtractor: chunkExtractorSpy }, VALID_OPTIONS);

    session._triggerEvent({ type: 'message', payload: { content: 'hi' }, timestamp: 0 });

    expect(chunkExtractorSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'message' }));
    await handle.close();
  });

  it('close() flushes the sink and closes the session', async () => {
    const deps = createDeps();
    const handle = await resumeWorker(deps, VALID_OPTIONS);
    await handle.close();
    expect(deps.session.close).toHaveBeenCalled();
  });

  it('close() is idempotent', async () => {
    const deps = createDeps();
    const handle = await resumeWorker(deps, VALID_OPTIONS);
    await handle.close();
    await handle.close();
    expect(deps.session.close).toHaveBeenCalledTimes(1);
  });

  it('propagates errors from harness.resume without creating a transport', async () => {
    const harness: DirectHarnessSpawner = {
      harnessName: 'test',
      spawn: vi.fn(),
      resume: vi.fn().mockRejectedValue(new Error('session not found')),
    };
    const mutationFn = vi.fn();

    await expect(resumeWorker(
      { backend: { mutation: mutationFn }, sessionId: 's', harness, chunkExtractor: () => null, nowFn: () => 0 },
      VALID_OPTIONS
    )).rejects.toThrow('session not found');

    expect(mutationFn).not.toHaveBeenCalled();
  });
});
