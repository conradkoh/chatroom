import { describe, it, expect, vi } from 'vitest';

import { closeSession } from './close-session.js';
import type { CloseSessionDeps, CloseSessionInput } from './close-session.js';
import type { DirectHarnessSession } from '../entities/direct-harness-session.js';
import type { SessionJournal } from './open-session.js';
import type { SessionRepository } from '../ports/session-repository.js';

function mockSession(): DirectHarnessSession {
  return {
    harnessSessionId: 'sess-1',
    sessionTitle: 'test',
    prompt: vi.fn(),
    onEvent: vi.fn().mockReturnValue(() => {}),
    close: vi.fn(),
    _emit: vi.fn(),
  } as unknown as DirectHarnessSession;
}

function mockJournal(): SessionJournal {
  return {
    record: vi.fn(),
    commit: vi.fn(),
  };
}

function mockDeps(overrides?: Partial<CloseSessionDeps>): CloseSessionDeps {
  return {
    session: mockSession(),
    journal: mockJournal(),
    ...overrides,
  };
}

const defaultInput: CloseSessionInput = {
  harnessSessionRowId: 'row-1',
};

describe('closeSession', () => {
  it('commits the journal and closes the session', async () => {
    const session = mockSession();
    const journal = mockJournal();
    const deps = mockDeps({ session, journal });

    await closeSession(deps, defaultInput);

    expect(journal.commit).toHaveBeenCalledOnce();
    expect(session.close).toHaveBeenCalledOnce();
  });

  it('calls markClosed when a sessionRepository is provided', async () => {
    const sessionRepository: SessionRepository = {
      createSession: vi.fn(),
      associateHarnessSessionId: vi.fn(),
      getHarnessSessionId: vi.fn(),
      markClosed: vi.fn(),
    };
    const deps = mockDeps({ sessionRepository });
    const spy = vi.spyOn(sessionRepository, 'markClosed');

    await closeSession(deps, defaultInput);

    expect(spy).toHaveBeenCalledWith('row-1');
  });

  it('does not call markClosed when sessionRepository is omitted', async () => {
    const deps = mockDeps({ sessionRepository: undefined });
    // Should not throw
    await expect(closeSession(deps, defaultInput)).resolves.toBeUndefined();
  });

  it('still closes the session when journal.commit fails (best-effort)', async () => {
    const session = mockSession();
    const journal = mockJournal();
    (journal.commit as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('transport down'));
    const deps = mockDeps({ session, journal });

    await closeSession(deps, defaultInput);

    // Session close should still be called even though journal commit failed
    expect(session.close).toHaveBeenCalledOnce();
  });

  it('still returns successfully when markClosed fails (best-effort)', async () => {
    const sessionRepository: SessionRepository = {
      createSession: vi.fn(),
      associateHarnessSessionId: vi.fn(),
      getHarnessSessionId: vi.fn(),
      markClosed: vi.fn().mockRejectedValue(new Error('backend error')),
    };
    const deps = mockDeps({ sessionRepository });

    await expect(closeSession(deps, defaultInput)).resolves.toBeUndefined();
  });

  it('closes the session even when both journal.commit and markClosed fail', async () => {
    const session = mockSession();
    const journal = mockJournal();
    (journal.commit as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('transport down'));
    const sessionRepository: SessionRepository = {
      createSession: vi.fn(),
      associateHarnessSessionId: vi.fn(),
      getHarnessSessionId: vi.fn(),
      markClosed: vi.fn().mockRejectedValue(new Error('backend error')),
    };
    const deps = mockDeps({ session, journal, sessionRepository });

    await closeSession(deps, defaultInput);

    expect(session.close).toHaveBeenCalledOnce();
  });
});
