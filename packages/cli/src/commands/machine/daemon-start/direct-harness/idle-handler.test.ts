import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleSessionIdle } from './idle-handler.js';
import type { DirectHarnessSession } from '../../../../domain/direct-harness/entities/direct-harness-session.js';
import type { SessionRepository } from '../../../../domain/direct-harness/ports/session-repository.js';
import type {
  SessionHandle,
  SessionJournal,
} from '../../../../domain/direct-harness/usecases/open-session.js';

// ─── Mock helpers ─────────────────────────────────────────────────────────────

function makeSessionRepository(): SessionRepository {
  return {
    associateOpenCodeSessionId: vi.fn().mockResolvedValue(undefined),
    getOpenCodeSessionId: vi.fn().mockResolvedValue(undefined),
    markClosed: vi.fn().mockResolvedValue(undefined),
    markIdle: vi.fn().mockResolvedValue(undefined),
    markFailed: vi.fn().mockResolvedValue(undefined),
    markActive: vi.fn().mockResolvedValue(undefined),
    markTurnProcessed: vi.fn().mockResolvedValue(undefined),
    setGenerating: vi.fn().mockResolvedValue(undefined),
    dequeueNext: vi.fn().mockResolvedValue(null), // queue empty by default
    beginAssistantTurn: vi.fn().mockResolvedValue({ turnId: 'turn-new', turnSeq: 2 }),
    bindTurnMessageId: vi.fn().mockResolvedValue(undefined),
    finalizeAssistantTurn: vi.fn().mockResolvedValue(undefined),
    updateSessionTitle: vi.fn().mockResolvedValue(undefined),
  } satisfies SessionRepository;
}

function makeJournal(): SessionJournal {
  return {
    record: vi.fn(),
    flush: vi.fn().mockResolvedValue(undefined),
    commit: vi.fn().mockResolvedValue(undefined),
  };
}

function makeSession(): DirectHarnessSession {
  return {
    opencodeSessionId: 'sdk-sess-1' as never,
    sessionTitle: 'Test Session',
    prompt: vi.fn().mockResolvedValue(undefined),
    onEvent: vi.fn().mockReturnValue(() => {}),
    close: vi.fn().mockResolvedValue(undefined),
    setTitle: vi.fn(),
  };
}

function makeHandle(
  rowId: string,
  session: DirectHarnessSession,
  journal: SessionJournal,
  turnId: string | null = 'turn-123'
): SessionHandle {
  return {
    harnessSessionId: rowId,
    harnessName: 'opencode-sdk',
    opencodeSessionId: 'sdk-sess-1',
    workspaceId: 'workspace-1',
    session,
    journal,
    currentTurn: turnId ? { turnId, messageId: null } : null,
    close: vi.fn().mockResolvedValue(undefined),
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('handleSessionIdle', () => {
  let repo: SessionRepository;
  let journal: SessionJournal;
  let session: DirectHarnessSession;

  beforeEach(() => {
    repo = makeSessionRepository();
    journal = makeJournal();
    session = makeSession();
  });

  it('flushes journal and finalizes the current turn on session.idle', async () => {
    const handle = makeHandle('row-1', session, journal, 'turn-abc');

    await handleSessionIdle(handle, journal, { agent: 'build' }, repo);

    // Journal must be flushed before finalizing
    expect(journal.flush).toHaveBeenCalledOnce();
    expect(repo.finalizeAssistantTurn).toHaveBeenCalledOnce();
    expect(repo.finalizeAssistantTurn).toHaveBeenCalledWith('turn-abc');
  });

  it('clears currentTurn after finalization', async () => {
    const handle = makeHandle('row-1', session, journal, 'turn-abc');
    expect(handle.currentTurn).not.toBeNull();

    await handleSessionIdle(handle, journal, { agent: 'build' }, repo);

    expect(handle.currentTurn).toBeNull();
  });

  it('does NOT call finalizeAssistantTurn when currentTurn is null', async () => {
    const handle = makeHandle('row-1', session, journal, null);

    await handleSessionIdle(handle, journal, { agent: 'build' }, repo);

    expect(journal.flush).not.toHaveBeenCalled();
    expect(repo.finalizeAssistantTurn).not.toHaveBeenCalled();
  });

  it('dequeues next message after finalization (queue empty → no new prompt)', async () => {
    (repo.dequeueNext as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const handle = makeHandle('row-1', session, journal, 'turn-abc');

    await handleSessionIdle(handle, journal, { agent: 'build' }, repo);

    expect(repo.dequeueNext).toHaveBeenCalledWith('row-1');
    expect(session.prompt).not.toHaveBeenCalled();
  });

  it('sends next queued message when dequeueNext returns one', async () => {
    (repo.dequeueNext as ReturnType<typeof vi.fn>).mockResolvedValue({ content: 'hello', seq: 2 });
    const handle = makeHandle('row-1', session, journal, 'turn-abc');

    await handleSessionIdle(handle, journal, { agent: 'build' }, repo);

    expect(session.prompt).toHaveBeenCalledWith(
      expect.objectContaining({ parts: [{ type: 'text', text: 'hello' }] })
    );
  });

  // ── Two-session variant ──────────────────────────────────────────────────────

  it('idle on session A only finalizes A turn, not B turn', async () => {
    const sessionA = makeSession();
    const sessionB = makeSession();
    const journalA = makeJournal();
    const journalB = makeJournal();

    const handleA = makeHandle('row-A', sessionA, journalA, 'turn-A');
    const handleB = makeHandle('row-B', sessionB, journalB, 'turn-B');

    // Trigger idle only for session A
    await handleSessionIdle(handleA, journalA, { agent: 'build' }, repo);

    // A finalized
    expect(repo.finalizeAssistantTurn).toHaveBeenCalledOnce();
    expect(repo.finalizeAssistantTurn).toHaveBeenCalledWith('turn-A');

    // B's turn is untouched
    expect(handleB.currentTurn).toEqual({ turnId: 'turn-B', messageId: null });
    expect(journalB.flush).not.toHaveBeenCalled();
  });

  it('idle on session B only finalizes B turn, not A turn', async () => {
    const sessionA = makeSession();
    const sessionB = makeSession();
    const journalA = makeJournal();
    const journalB = makeJournal();

    const handleA = makeHandle('row-A', sessionA, journalA, 'turn-A');
    const handleB = makeHandle('row-B', sessionB, journalB, 'turn-B');

    // Trigger idle only for session B
    await handleSessionIdle(handleB, journalB, { agent: 'build' }, repo);

    // B finalized
    expect(repo.finalizeAssistantTurn).toHaveBeenCalledWith('turn-B');
    // A's turn untouched
    expect(handleA.currentTurn).toEqual({ turnId: 'turn-A', messageId: null });
    expect(journalA.flush).not.toHaveBeenCalled();
  });

  it('handles finalization error gracefully and continues dequeue', async () => {
    (repo.finalizeAssistantTurn as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('backend error')
    );
    const handle = makeHandle('row-1', session, journal, 'turn-abc');
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Should not throw
    await expect(
      handleSessionIdle(handle, journal, { agent: 'build' }, repo)
    ).resolves.toBeUndefined();

    // dequeueNext is still called after the error
    expect(repo.dequeueNext).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
