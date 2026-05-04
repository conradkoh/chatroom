import { describe, it, expect, vi } from 'vitest';

import { openSession } from './open-session.js';
import type { OpenSessionDeps, OpenSessionInput } from './open-session.js';
import type { SessionRepository } from '../ports/session-repository.js';
import type { BoundHarness } from '../entities/bound-harness.js';
import type { DirectHarnessSession, DirectHarnessSessionEvent } from '../entities/direct-harness-session.js';
import type { SessionJournal, JournalFactory } from './open-session.js';
import type { HarnessSessionRowId } from '../entities/harness-session.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

type Func = ReturnType<typeof vi.fn>;

function mockSession(): DirectHarnessSession {
  return {
    harnessSessionId: 'sess-1',
    sessionTitle: 'My Session',
    prompt: vi.fn(),
    onEvent: vi.fn().mockReturnValue(() => {}),
    close: vi.fn().mockResolvedValue(undefined),
    _emit: vi.fn(),
  } as unknown as DirectHarnessSession;
}

function mockJournal(): SessionJournal {
  return {
    record: vi.fn(),
    commit: vi.fn().mockResolvedValue(undefined),
  };
}

function mockBoundHarness(session: DirectHarnessSession): BoundHarness {
  return {
    type: 'opencode-sdk',
    models: vi.fn(),
    newSession: vi.fn().mockResolvedValue(session),
    resumeSession: vi.fn(),
    isAlive: vi.fn().mockReturnValue(true),
    close: vi.fn(),
  };
}

const defaultInput: OpenSessionInput = {
  workspaceId: 'ws-1',
  workingDir: '/projects/test',
  harnessName: 'opencode-sdk',
  agent: 'builder',
};

/** Build deps that always succeed on the happy path. */
function buildPassingDeps(): {
  deps: OpenSessionDeps;
  session: DirectHarnessSession;
  journal: SessionJournal;
  harness: BoundHarness;
  sessionRepository: SessionRepository;
} {
  const session = mockSession();
  const journal = mockJournal();
  const harness = mockBoundHarness(session);
  const sessionRepository: SessionRepository = {
    createSession: vi.fn().mockResolvedValue({ harnessSessionRowId: 'row-1' }),
    associateHarnessSessionId: vi.fn().mockResolvedValue(undefined),
    getHarnessSessionId: vi.fn().mockResolvedValue('sess-1'),
    markClosed: vi.fn(),
  };
  const journalFactory: JournalFactory = { create: vi.fn().mockReturnValue(journal) };
  const chunkExtractor = vi.fn().mockReturnValue(null);

  const deps: OpenSessionDeps = {
    sessionRepository,
    spawnerProvider: { getSpawner: vi.fn().mockResolvedValue(harness) },
    journalFactory,
    chunkExtractor,
    nowFn: () => 1000,
  };

  return { deps, session, journal, harness, sessionRepository };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('openSession', () => {
  describe('happy path', () => {
    it('creates a backend row and associates the harness session ID', async () => {
      const { deps, sessionRepository } = buildPassingDeps();

      const result = await openSession(deps, defaultInput);

      expect(sessionRepository.createSession).toHaveBeenCalledWith('ws-1', 'opencode-sdk', {
        agent: 'builder',
      });
      expect(sessionRepository.associateHarnessSessionId).toHaveBeenCalledWith(
        'row-1',
        'sess-1',
        'My Session'
      );
      expect(result.harnessSessionRowId).toBe('row-1');
      expect(result.harnessSessionId).toBe('sess-1');
    });

    it('returns a close() function that flushes and cleans up', async () => {
      const { deps, session } = buildPassingDeps();

      const result = await openSession(deps, defaultInput);
      await result.close();

      expect(session.close).toHaveBeenCalledOnce();
    });

    it('close() is idempotent', async () => {
      const { deps, session } = buildPassingDeps();

      const result = await openSession(deps, defaultInput);
      await result.close();
      await result.close();

      expect(session.close).toHaveBeenCalledTimes(1);
    });

    it('wires session events through chunk extractor into the journal', async () => {
      const session = mockSession();
      let handler: ((event: DirectHarnessSessionEvent) => void) | undefined;
      (session.onEvent as Func).mockImplementation(
        (h: (event: DirectHarnessSessionEvent) => void) => {
          handler = h;
          return () => {};
        }
      );
      const journal = mockJournal();
      const harness = mockBoundHarness(session);
      const journalFactory: JournalFactory = { create: vi.fn().mockReturnValue(journal) };
      const chunkExtractor = vi.fn()
        .mockReturnValueOnce(null)
        .mockReturnValueOnce('chunk-a')
        .mockReturnValueOnce('chunk-b');
      const deps: OpenSessionDeps = {
        sessionRepository: {
          createSession: vi.fn().mockResolvedValue({ harnessSessionRowId: 'row-1' }),
          associateHarnessSessionId: vi.fn(),
          getHarnessSessionId: vi.fn(),
          markClosed: vi.fn(),
        },
        spawnerProvider: { getSpawner: vi.fn().mockResolvedValue(harness) },
        journalFactory,
        chunkExtractor,
        nowFn: () => 1000,
      };

      await openSession(deps, defaultInput);

      // Simulate events
      handler!({ type: 'message.part.updated', properties: { content: '' } } as unknown as DirectHarnessSessionEvent);
      handler!({ type: 'message.part.updated', properties: { content: 'a' } } as unknown as DirectHarnessSessionEvent);
      handler!({ type: 'message.part.updated', properties: { content: 'b' } } as unknown as DirectHarnessSessionEvent);

      expect(journal.record).toHaveBeenCalledTimes(2);
      expect(journal.record).toHaveBeenCalledWith({ content: 'chunk-a', timestamp: 1000 });
      expect(journal.record).toHaveBeenCalledWith({ content: 'chunk-b', timestamp: 1000 });
    });

    it('calls harness.newSession with the correct config', async () => {
      const { deps, harness } = buildPassingDeps();

      await openSession(deps, defaultInput);

      expect(harness.newSession).toHaveBeenCalledWith({
        agent: 'builder',
        harnessSessionRowId: 'row-1' as unknown as HarnessSessionRowId,
      });
    });
  });

  describe('error paths', () => {
    it('rolls back the harness session when association fails', async () => {
      const session = mockSession();
      const harness = mockBoundHarness(session);
      const sessionRepository: SessionRepository = {
        createSession: vi.fn().mockResolvedValue({ harnessSessionRowId: 'row-1' }),
        associateHarnessSessionId: vi.fn().mockRejectedValue(new Error('db error')),
        getHarnessSessionId: vi.fn(),
        markClosed: vi.fn(),
      };
      const deps: OpenSessionDeps = {
        sessionRepository,
        spawnerProvider: { getSpawner: vi.fn().mockResolvedValue(harness) },
        journalFactory: { create: vi.fn() },
        chunkExtractor: vi.fn(),
        nowFn: () => 1000,
      };

      await expect(openSession(deps, defaultInput)).rejects.toThrow('db error');

      // Session should be closed as rollback
      expect(session.close).toHaveBeenCalledOnce();
    });

    it('propagates error when harness.newSession fails', async () => {
      const harness = mockBoundHarness(mockSession());
      (harness.newSession as Func).mockRejectedValue(new Error('harness spawn failed'));
      const deps: OpenSessionDeps = {
        sessionRepository: {
          createSession: vi.fn().mockResolvedValue({ harnessSessionRowId: 'row-1' }),
          associateHarnessSessionId: vi.fn(),
          getHarnessSessionId: vi.fn(),
          markClosed: vi.fn(),
        },
        spawnerProvider: { getSpawner: vi.fn().mockResolvedValue(harness) },
        journalFactory: { create: vi.fn() },
        chunkExtractor: vi.fn(),
        nowFn: () => 1000,
      };

      await expect(openSession(deps, defaultInput)).rejects.toThrow('harness spawn failed');
    });

    it('propagates error when createSession fails', async () => {
      const sessionRepository: SessionRepository = {
        createSession: vi.fn().mockRejectedValue(new Error('backend down')),
        associateHarnessSessionId: vi.fn(),
        getHarnessSessionId: vi.fn(),
        markClosed: vi.fn(),
      };
      const deps: OpenSessionDeps = {
        sessionRepository,
        spawnerProvider: { getSpawner: vi.fn() },
        journalFactory: { create: vi.fn() },
        chunkExtractor: vi.fn(),
        nowFn: () => 1000,
      };

      await expect(openSession(deps, defaultInput)).rejects.toThrow('backend down');
    });

    it('propagates error when spawner provider fails', async () => {
      const deps = buildPassingDeps().deps;
      (deps.spawnerProvider.getSpawner as Func).mockRejectedValue(new Error('no harness'));

      await expect(openSession(deps, defaultInput)).rejects.toThrow('no harness');
    });
  });

  describe('close() error handling', () => {
    it('does not throw when journal.commit fails during close', async () => {
      const { deps } = buildPassingDeps();

      const result = await openSession(deps, defaultInput);
      await expect(result.close()).resolves.toBeUndefined();
    });
  });
});
