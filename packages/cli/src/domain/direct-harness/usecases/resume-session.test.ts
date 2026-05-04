import { describe, it, expect, vi } from 'vitest';

import { resumeSession } from './resume-session.js';
import type { ResumeSessionDeps, ResumeSessionInput } from './resume-session.js';
import type { BoundHarness } from '../entities/bound-harness.js';
import type { DirectHarnessSession, DirectHarnessSessionEvent } from '../entities/direct-harness-session.js';
import type { SessionJournal, JournalFactory } from './open-session.js';
import type { HarnessSessionId } from '../entities/harness-session.js';
import type { CloseSessionDeps, CloseSessionInput } from './close-session.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

type Func = ReturnType<typeof vi.fn>;

function mockSession(overrides?: Partial<DirectHarnessSession>): DirectHarnessSession {
  return {
    harnessSessionId: 'sess-1',
    sessionTitle: 'test',
    prompt: vi.fn(),
    onEvent: vi.fn().mockReturnValue(() => {}),
    close: vi.fn(),
    _emit: vi.fn(),
    ...overrides,
  } as unknown as DirectHarnessSession;
}

function mockJournal(): SessionJournal {
  return {
    record: vi.fn(),
    commit: vi.fn(),
  };
}

function mockBoundHarness(): BoundHarness {
  return {
    type: 'opencode-sdk',
    models: vi.fn(),
    newSession: vi.fn(),
    resumeSession: vi.fn(),
    isAlive: vi.fn().mockReturnValue(true),
    close: vi.fn(),
  };
}

const defaultInput: ResumeSessionInput = {
  harnessSessionRowId: 'row-1',
  harnessSessionId: 'sess-1',
};

describe('resumeSession', () => {
  it('resumes a session, wires events, and returns a SessionHandle', async () => {
    const session = mockSession();
    const harness = mockBoundHarness();
    (harness.resumeSession as Func).mockResolvedValue(session);
    const journal = mockJournal();
    const journalFactory: JournalFactory = {
      create: vi.fn().mockReturnValue(journal),
    };
    const chunkExtractor = vi.fn().mockReturnValue(null);
    const deps: ResumeSessionDeps = {
      harness,
      journalFactory,
      chunkExtractor,
      nowFn: () => 1000,
    };

    const result = await resumeSession(deps, defaultInput);

    expect(harness.resumeSession).toHaveBeenCalledWith('sess-1' as HarnessSessionId, {
      harnessSessionRowId: 'row-1',
    });
    expect(journalFactory.create).toHaveBeenCalledWith('row-1');
    expect(session.onEvent).toHaveBeenCalledOnce();
    expect(result.harnessSessionRowId).toBe('row-1');
    expect(result.harnessSessionId).toBe('sess-1');
    expect(result.session).toBe(session);
  });

  it('wires events through chunk extractor into the journal', async () => {
    const session = mockSession();
    let onEventHandler: ((event: DirectHarnessSessionEvent) => void) | undefined;
    (session.onEvent as Func).mockImplementation((handler: (event: DirectHarnessSessionEvent) => void) => {
      onEventHandler = handler;
      return () => {};
    });
    const harness = mockBoundHarness();
    (harness.resumeSession as Func).mockResolvedValue(session);
    const journal = mockJournal();
    const journalFactory: JournalFactory = {
      create: vi.fn().mockReturnValue(journal),
    };
    const chunkExtractor = vi.fn()
      .mockReturnValueOnce(null)   // first event, no content
      .mockReturnValueOnce('hello') // second event, has content
      .mockReturnValueOnce('world'); // third event, has content
    const deps: ResumeSessionDeps = {
      harness, journalFactory, chunkExtractor, nowFn: () => 1000,
    };

    await resumeSession(deps, defaultInput);

    expect(onEventHandler).toBeDefined();

    // Simulate some events
    onEventHandler!({ type: 'message.part.updated', properties: { content: '' } } as unknown as DirectHarnessSessionEvent);
    onEventHandler!({ type: 'message.part.updated', properties: { content: 'hello' } } as unknown as DirectHarnessSessionEvent);
    onEventHandler!({ type: 'message.part.updated', properties: { content: 'world' } } as unknown as DirectHarnessSessionEvent);

    expect(journal.record).toHaveBeenCalledTimes(2);
    expect(journal.record).toHaveBeenCalledWith({ content: 'hello', timestamp: 1000 });
    expect(journal.record).toHaveBeenCalledWith({ content: 'world', timestamp: 1000 });
  });

  it('close() is idempotent and delegates to closeSession', async () => {
    const session = mockSession();
    const harness = mockBoundHarness();
    (harness.resumeSession as Func).mockResolvedValue(session);
    const journal = mockJournal();
    const journalFactory: JournalFactory = {
      create: vi.fn().mockReturnValue(journal),
    };
    const deps: ResumeSessionDeps = {
      harness, journalFactory,
      chunkExtractor: vi.fn().mockReturnValue(null),
      nowFn: () => 1000,
    };

    const result = await resumeSession(deps, defaultInput);

    // Call close twice
    await result.close();
    await result.close();

    // journal.commit and session.close should only be called once
    expect(journal.commit).toHaveBeenCalledTimes(1);
    expect(session.close).toHaveBeenCalledTimes(1);
  });

  it('propagates errors when harness.resumeSession fails', async () => {
    const harness = mockBoundHarness();
    (harness.resumeSession as Func).mockRejectedValue(new Error('harness not found'));
    const journalFactory: JournalFactory = { create: vi.fn() };
    const deps: ResumeSessionDeps = {
      harness, journalFactory,
      chunkExtractor: vi.fn(),
      nowFn: () => 1000,
    };

    await expect(resumeSession(deps, defaultInput)).rejects.toThrow('harness not found');
    expect(journalFactory.create).not.toHaveBeenCalled();
  });

  it('uses Date.now when nowFn is not provided', async () => {
    let onEventHandler: ((event: DirectHarnessSessionEvent) => void) | undefined;
    const session = mockSession();
    (session.onEvent as Func).mockImplementation((h: (event: DirectHarnessSessionEvent) => void) => {
      onEventHandler = h;
      return () => {};
    });
    const harness = mockBoundHarness();
    (harness.resumeSession as Func).mockResolvedValue(session);
    const journal = mockJournal();
    const journalFactory: JournalFactory = { create: vi.fn().mockReturnValue(journal) };
    const chunkExtractor = vi.fn().mockReturnValue('content');
    const deps: ResumeSessionDeps = {
      harness, journalFactory, chunkExtractor,
      // no nowFn — should use Date.now
    };

    const before = Date.now();
    await resumeSession(deps, defaultInput);

    // Trigger an event
    onEventHandler!({ type: 'message.part.updated' } as unknown as DirectHarnessSessionEvent);

    const after = Date.now();

    expect(journal.record).toHaveBeenCalledOnce();
    const recordedTimestamp = (journal.record as Func).mock.calls[0][0].timestamp;
    expect(recordedTimestamp).toBeGreaterThanOrEqual(before);
    expect(recordedTimestamp).toBeLessThanOrEqual(after);
  });
});
