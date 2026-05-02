import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { HarnessProcessRegistry } from './get-or-spawn-harness.js';
import { openSession } from './open-session.js';
import type { OpenSessionDeps, OpenSessionOptions } from './open-session.js';
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
    harnessSessionId: 'harness-session-123' as any,
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

function createMockRegistry(session: DirectHarnessSession): HarnessProcessRegistry {
  const spawner = createMockSpawner(session);
  return {
    getOrSpawn: vi.fn().mockResolvedValue({ workspaceId: 'ws-1', spawner, isAlive: () => true, kill: vi.fn(), listAgents: vi.fn().mockResolvedValue([]) }),
    invalidate: vi.fn(),
    killAll: vi.fn(),
    size: 0,
    setOnHarnessBooted: vi.fn(),
  } as any;
}

function createDeps(overrides: Partial<OpenSessionDeps> = {}): OpenSessionDeps & {
  mutationFn: ReturnType<typeof vi.fn>;
  session: ReturnType<typeof createMockSession>;
} {
  const session = createMockSession();
  const mutationFn = vi.fn();
  mutationFn.mockResolvedValueOnce({ harnessSessionRowId: 'backend-session-1' }); // openSession
  mutationFn.mockResolvedValue(undefined); // associateHarnessSessionId

  const harnessRegistry = createMockRegistry(session);
  const chunkExtractor = vi.fn((e: DirectHarnessSessionEvent) =>
    e.type === 'message' ? String((e.payload as any)?.content ?? '') : null
  );

  return {
    backend: { mutation: mutationFn, query: vi.fn().mockResolvedValue(undefined) },
    sessionId: 'test-session',
    harnessRegistry,
    chunkExtractor,
    nowFn: () => 0,
    ...overrides,
    mutationFn,
    session,
  };
}

const VALID_OPTIONS: OpenSessionOptions = {
  workspaceId: 'workspace-1',
  workingDir: '/tmp/ws1',
  harnessName: 'opencode-sdk',
  agent: 'builder',
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('openSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls backend openSession → getOrSpawn → spawner.openSession → associateHarnessSessionId', async () => {
    const deps = createDeps();

    await openSession(deps, VALID_OPTIONS);

    const callOrder = deps.mutationFn.mock.calls.map((c: any[]) => c[0]);
    expect(callOrder[0]).toBe('mock-openSession');
    expect(callOrder[1]).toBe('mock-associateHarnessSessionId');
    expect((deps.harnessRegistry as any).getOrSpawn).toHaveBeenCalledWith('workspace-1', '/tmp/ws1');
  });

  it('returns a SessionHandle with harnessSessionRowId from the backend', async () => {
    const deps = createDeps();
    const handle = await openSession(deps, VALID_OPTIONS);
    expect(handle.harnessSessionRowId).toBe('backend-session-1');
  });

  it('returns a SessionHandle with harnessSessionId from the harness session', async () => {
    const deps = createDeps();
    const handle = await openSession(deps, VALID_OPTIONS);
    expect(handle.harnessSessionId).toBe('harness-session-123');
  });

  it('closes the harness session and rethrows if associateHarnessSessionId fails', async () => {
    const mutationFn = vi.fn();
    mutationFn.mockResolvedValueOnce({ harnessSessionRowId: 'session-fail' });
    mutationFn.mockRejectedValueOnce(new Error('associate failed'));

    const session = createMockSession();
    const deps = createDeps({
      backend: { mutation: mutationFn, query: vi.fn().mockResolvedValue(undefined) },
      harnessRegistry: createMockRegistry(session),
    });

    await expect(openSession(deps, VALID_OPTIONS)).rejects.toThrow('associate failed');
    expect(session.close).toHaveBeenCalled();
  });

  it('does NOT get or spawn a harness if backend openSession throws', async () => {
    const mutationFn = vi.fn().mockRejectedValue(new Error('backend down'));
    const deps = createDeps({ backend: { mutation: mutationFn, query: vi.fn() } });

    await expect(openSession(deps, VALID_OPTIONS)).rejects.toThrow('backend down');
    expect((deps.harnessRegistry as any).getOrSpawn).not.toHaveBeenCalled();
  });

  it('close() is idempotent', async () => {
    const deps = createDeps();
    const handle = await openSession(deps, VALID_OPTIONS);

    await handle.close();
    await handle.close();

    expect(deps.session.close).toHaveBeenCalledTimes(1);
  });

  it('events flow through chunkExtractor', async () => {
    const deps = createDeps();
    await openSession(deps, VALID_OPTIONS);

    deps.session._triggerEvent({ type: 'message', payload: { content: 'hello' }, timestamp: 0 });

    expect(deps.chunkExtractor).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'message' })
    );
  });
});
