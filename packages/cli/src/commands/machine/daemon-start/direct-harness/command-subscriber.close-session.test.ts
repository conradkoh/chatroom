import { describe, expect, it, vi } from 'vitest';

import { closeHarnessSession } from './command-subscriber.js';
import type { CommandSubscriberDeps, DirectHarnessSession } from './command-subscriber.js';

function mockSession(getSessionResult: Record<string, unknown> | null): DirectHarnessSession {
  return {
    sessionId: 'sess-1' as never,
    machineId: 'machine-1',
    convexUrl: 'https://example.convex.cloud',
    backend: {
      query: vi.fn().mockResolvedValue(getSessionResult),
      mutation: vi.fn().mockResolvedValue(undefined),
    },
  };
}

function mockDeps(overrides?: Partial<CommandSubscriberDeps>): CommandSubscriberDeps {
  return {
    lifecycleManager: {
      getOrStart: vi.fn(),
    } as never,
    publisher: {} as never,
    activeSessions: new Map(),
    sessionRepository: {
      markClosed: vi.fn().mockResolvedValue(undefined),
    } as never,
    ...overrides,
  };
}

describe('closeHarnessSession', () => {
  it('calls handle.close and removes from activeSessions when live', async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const activeSessions = new Map([['row-1', { close } as never]]);
    const deps = mockDeps({ activeSessions });
    const session = mockSession({ status: 'active', opencodeSessionId: 'sdk-1' });

    await closeHarnessSession(session, deps, 'row-1');

    expect(close).toHaveBeenCalledOnce();
    expect(activeSessions.has('row-1')).toBe(false);
    expect(deps.sessionRepository.markClosed).not.toHaveBeenCalled();
  });

  it('marks closed in backend for pending sessions without opencodeSessionId', async () => {
    const deps = mockDeps();
    const session = mockSession({ status: 'pending' });

    await closeHarnessSession(session, deps, 'row-pending');

    expect(deps.sessionRepository.markClosed).toHaveBeenCalledWith('row-pending');
  });

  it('resumes and closes idle sessions with opencodeSessionId', async () => {
    const liveClose = vi.fn().mockResolvedValue(undefined);
    const resumeSession = vi.fn().mockResolvedValue({ close: liveClose });
    const getOrStart = vi.fn().mockResolvedValue({ resumeSession });
    const deps = mockDeps({
      lifecycleManager: { getOrStart } as never,
    });
    const session = mockSession({
      status: 'idle',
      opencodeSessionId: 'sdk-idle',
      harnessName: 'opencode-sdk',
      workspaceId: 'ws-1',
    });

    await closeHarnessSession(session, deps, 'row-idle');

    expect(getOrStart).toHaveBeenCalledWith('ws-1', 'opencode-sdk');
    expect(resumeSession).toHaveBeenCalledWith('sdk-idle', { harnessSessionId: 'row-idle' });
    expect(liveClose).toHaveBeenCalledOnce();
    expect(deps.sessionRepository.markClosed).toHaveBeenCalledWith('row-idle');
  });

  it('no-ops for already closed sessions', async () => {
    const deps = mockDeps();
    const session = mockSession({ status: 'closed' });

    await closeHarnessSession(session, deps, 'row-closed');

    expect(deps.sessionRepository.markClosed).not.toHaveBeenCalled();
  });
});
