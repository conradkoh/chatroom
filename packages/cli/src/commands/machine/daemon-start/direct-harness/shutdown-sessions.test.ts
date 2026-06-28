import { describe, expect, it, vi } from 'vitest';

import type { DirectHarnessSession } from './command-subscriber.js';
import { closeAllMachineHarnessSessionsOnShutdown } from './shutdown-sessions.js';

const closeHarnessSession = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('./command-subscriber.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as Record<string, unknown>),
    closeHarnessSession,
  };
});

function mockSession(): DirectHarnessSession {
  return {
    sessionId: 'sess-1' as never,
    machineId: 'machine-1',
    convexUrl: 'https://example.convex.cloud',
    backend: {
      query: vi
        .fn()
        .mockResolvedValueOnce([
          { harnessSessionId: 'row-active' },
          { harnessSessionId: 'row-idle' },
        ])
        .mockResolvedValueOnce([{ _id: 'row-pending' }]),
      mutation: vi.fn().mockResolvedValue({ failedTurns: 0 }),
    },
  };
}

describe('closeAllMachineHarnessSessionsOnShutdown', () => {
  it('closes active, idle, and pending sessions for the machine', async () => {
    closeHarnessSession.mockClear();
    const session = mockSession();
    const sessionRepository = { markClosed: vi.fn().mockResolvedValue(undefined) };

    await closeAllMachineHarnessSessionsOnShutdown(session, {
      lifecycleManager: {} as never,
      activeSessions: new Map(),
      sessionRepository: sessionRepository as never,
    });

    expect(closeHarnessSession).toHaveBeenCalledTimes(3);
    expect(closeHarnessSession).toHaveBeenCalledWith(
      session,
      expect.objectContaining({ sessionRepository }),
      'row-active'
    );
    expect(closeHarnessSession).toHaveBeenCalledWith(
      session,
      expect.objectContaining({ sessionRepository }),
      'row-idle'
    );
    expect(closeHarnessSession).toHaveBeenCalledWith(
      session,
      expect.objectContaining({ sessionRepository }),
      'row-pending'
    );
  });

  it('falls back to markClosed when closeHarnessSession throws', async () => {
    closeHarnessSession.mockClear();
    closeHarnessSession.mockRejectedValue(new Error('resume failed'));
    const session = {
      ...mockSession(),
      backend: {
        query: vi
          .fn()
          .mockResolvedValueOnce([{ harnessSessionId: 'row-active' }])
          .mockResolvedValueOnce([]),
        mutation: vi.fn().mockResolvedValue({ failedTurns: 0 }),
      },
    };
    const markClosed = vi.fn().mockResolvedValue(undefined);

    await closeAllMachineHarnessSessionsOnShutdown(session, {
      lifecycleManager: {} as never,
      activeSessions: new Map(),
      sessionRepository: { markClosed } as never,
    });

    expect(markClosed).toHaveBeenCalledWith('row-active');
  });
});
