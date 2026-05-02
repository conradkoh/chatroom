import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resumeSession } from './resume-session.js';
import type { ResumeSessionDeps, ResumeSessionOptions } from './resume-session.js';
import type {
  DirectHarnessSpawner,
  DirectHarnessSession,
  DirectHarnessSessionEvent,
} from '../../domain/direct-harness/index.js';

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('../../api.js', () => ({
  api: {
    chatroom: {
      directHarness: {
        sessions: {
          openSession: 'mock-openSession',
          associateHarnessSessionId: 'mock-associateHarnessSessionId',
        },
        messages: {
          appendMessages: 'mock-appendMessages',
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
    prompt: vi.fn().mockResolvedValue(undefined),
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

function createMockSpawner(session: DirectHarnessSession): DirectHarnessSpawner {
  return {
    harnessName: 'test-harness',
    openSession: vi.fn().mockResolvedValue(session),
    resumeSession: vi.fn().mockResolvedValue(session),
  };
}

function createDeps(sessionOverride?: DirectHarnessSession): ResumeSessionDeps & {
  mutationFn: ReturnType<typeof vi.fn>;
  session: ReturnType<typeof createMockSession>;
  spawner: DirectHarnessSpawner;
} {
  const session = sessionOverride ?? createMockSession();
  const mutationFn = vi.fn().mockResolvedValue(undefined);
  const spawner = createMockSpawner(session);
  const chunkExtractor = (e: DirectHarnessSessionEvent) =>
    e.type === 'message' ? String((e.payload as any)?.content ?? '') : null;

  return {
    backend: { mutation: mutationFn },
    sessionId: 'test-session',
    spawner,
    chunkExtractor,
    nowFn: () => 0,
    mutationFn,
    session: session as any,
  };
}

const VALID_OPTIONS: ResumeSessionOptions = {
  harnessSessionRowId: 'existing-session-row-id',
  harnessSessionId: 'existing-harness-session-id',
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('resumeSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls spawner.resumeSession with the supplied harnessSessionId', async () => {
    const deps = createDeps();
    await resumeSession(deps, VALID_OPTIONS);
    expect(deps.spawner.resumeSession).toHaveBeenCalledWith('existing-harness-session-id');
  });

  it('does NOT make any backend mutations', async () => {
    const deps = createDeps();
    await resumeSession(deps, VALID_OPTIONS);
    expect(deps.mutationFn).not.toHaveBeenCalled();
  });

  it('returns a SessionHandle with the supplied harnessSessionRowId', async () => {
    const deps = createDeps();
    const handle = await resumeSession(deps, VALID_OPTIONS);
    expect(handle.harnessSessionRowId).toBe('existing-session-row-id');
  });

  it('returns a SessionHandle with the supplied harnessSessionId', async () => {
    const deps = createDeps();
    const handle = await resumeSession(deps, VALID_OPTIONS);
    expect(handle.harnessSessionId).toBe('existing-harness-session-id');
  });

  it('events flow through chunkExtractor', async () => {
    const session = createMockSession();
    const deps = createDeps(session);
    const chunkExtractorSpy = vi.fn(() => 'hello');
    const handle = await resumeSession({ ...deps, chunkExtractor: chunkExtractorSpy }, VALID_OPTIONS);

    session._triggerEvent({ type: 'message', payload: { content: 'hi' }, timestamp: 0 });

    expect(chunkExtractorSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'message' }));
    await handle.close();
  });

  it('close() flushes the sink and closes the session', async () => {
    const deps = createDeps();
    const handle = await resumeSession(deps, VALID_OPTIONS);
    await handle.close();
    expect(deps.session.close).toHaveBeenCalled();
  });

  it('close() is idempotent', async () => {
    const deps = createDeps();
    const handle = await resumeSession(deps, VALID_OPTIONS);
    await handle.close();
    await handle.close();
    expect(deps.session.close).toHaveBeenCalledTimes(1);
  });

  it('propagates errors from spawner.resumeSession without creating a transport', async () => {
    const spawner: DirectHarnessSpawner = {
      harnessName: 'test',
      openSession: vi.fn(),
      resumeSession: vi.fn().mockRejectedValue(new Error('session not found')),
    };
    const mutationFn = vi.fn();

    await expect(resumeSession(
      { backend: { mutation: mutationFn }, sessionId: 's', spawner, chunkExtractor: () => null, nowFn: () => 0 },
      VALID_OPTIONS
    )).rejects.toThrow('session not found');

    expect(mutationFn).not.toHaveBeenCalled();
  });
});
