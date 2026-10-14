import { describe, it, expect, vi, beforeEach } from 'vitest';

import { drainPendingAgenticQueryMessages } from './prompt-drain.js';
import type { AgenticQuerySubscriptionSession } from './start-subscriptions.js';
import type { AgenticPendingBatch } from './types.js';
import type { DirectHarnessSession } from '../../domain/entities/direct-harness-session.js';
import type {
  SessionRepository,
  SessionHandle,
} from '../../domain/usecase/open-harness-session.js';
import type { ActiveSession } from '../shared-harness/types.js';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const ROW_ID = 'row-1';

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
    dequeueNext: vi.fn().mockResolvedValue(null),
    beginAssistantTurn: vi.fn().mockResolvedValue({ turnId: 'turn-new', turnSeq: 2 }),
    bindTurnMessageId: vi.fn().mockResolvedValue(undefined),
    finalizeAssistantTurn: vi.fn().mockResolvedValue(undefined),
    updateSessionTitle: vi.fn().mockResolvedValue(undefined),
  } satisfies SessionRepository;
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

/** A pending batch with one agentic-query session and the given queued messages. */
function makeBatch(messages: { seq: number; content: string }[]): AgenticPendingBatch {
  return {
    sessions: [
      {
        kind: 'agentic-query',
        runId: ROW_ID,
        workspaceId: 'workspace-1',
        harnessName: 'opencode-sdk',
        opencodeSessionId: 'sdk-sess-1',
        agenticQueryId: 'query-1',
        chatroomId: 'chatroom-1',
        lastUsedConfig: { agent: 'build' },
      },
    ],
    messages: messages.map((m) => ({ runId: ROW_ID, ...m })),
  };
}

function makeDaemonSession(batch: AgenticPendingBatch): AgenticQuerySubscriptionSession {
  return {
    sessionId: 'daemon-session-1',
    machineId: 'machine-1',
    convexUrl: 'https://convex.test',
    backend: { query: vi.fn().mockResolvedValue(batch) },
  } as unknown as AgenticQuerySubscriptionSession;
}

/** Build a drain-ready active session so resolveSessionHandle returns it without starting a harness. */
function makeActiveSession(session: DirectHarnessSession): ActiveSession {
  const handle: SessionHandle = {
    harnessSessionId: ROW_ID,
    harnessName: 'opencode-sdk',
    opencodeSessionId: 'sdk-sess-1',
    workspaceId: 'workspace-1',
    session,
    journal: { record: vi.fn(), flush: vi.fn(), commit: vi.fn() },
    currentTurn: null,
    close: vi.fn().mockResolvedValue(undefined),
  };
  return handle;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('drainPendingAgenticQueryMessages', () => {
  let repo: SessionRepository;
  let session: DirectHarnessSession;
  let active: ActiveSession;

  beforeEach(() => {
    repo = makeSessionRepository();
    session = makeSession();
    active = makeActiveSession(session);
  });

  function drain(batch: AgenticPendingBatch) {
    return drainPendingAgenticQueryMessages(makeDaemonSession(batch), {
      activeSessions: new Map([[ROW_ID, active]]),
      harnesses: new Map(),
      sessionRepository: repo,
      journalFactory: {} as never,
    });
  }

  it('delivers queued messages in order and marks each processed on success', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await drain(
      makeBatch([
        { seq: 1, content: 'first' },
        { seq: 2, content: 'second' },
      ])
    );

    expect(session.prompt).toHaveBeenCalledTimes(2);
    expect(vi.mocked(session.prompt).mock.calls[0]?.[0]).toMatchObject({
      parts: [{ type: 'text', text: 'first' }],
    });
    expect(vi.mocked(session.prompt).mock.calls[1]?.[0]).toMatchObject({
      parts: [{ type: 'text', text: 'second' }],
    });
    expect(repo.markTurnProcessed).toHaveBeenNthCalledWith(1, ROW_ID, 1);
    expect(repo.markTurnProcessed).toHaveBeenNthCalledWith(2, ROW_ID, 2);
    expect(repo.setGenerating).not.toHaveBeenCalledWith(ROW_ID, false);
    warn.mockRestore();
  });

  it('a rejected prompt is marked processed and the next message is still delivered', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(session.prompt)
      .mockRejectedValueOnce(new Error('Agent not found: "build"'))
      .mockResolvedValueOnce(undefined);

    await expect(
      drain(
        makeBatch([
          { seq: 1, content: 'first' },
          { seq: 2, content: 'second' },
        ])
      )
    ).resolves.toBeUndefined();

    expect(repo.markTurnProcessed).toHaveBeenCalledWith(ROW_ID, 1);
    expect(repo.markTurnProcessed).toHaveBeenCalledWith(ROW_ID, 2);
    expect(repo.setGenerating).toHaveBeenCalledWith(ROW_ID, false);
    expect(session.prompt).toHaveBeenCalledTimes(2);
    expect(vi.mocked(session.prompt).mock.calls[1]?.[0]).toMatchObject({
      parts: [{ type: 'text', text: 'second' }],
    });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('prompt failed for session row-1 seq=1')
    );
    warn.mockRestore();
  });

  it('clears the turn pointer when a prompt is rejected', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(session.prompt).mockRejectedValueOnce(new Error('interrupted'));

    await drain(makeBatch([{ seq: 1, content: 'first' }]));

    expect(active.currentTurn).toBeNull();
    warn.mockRestore();
  });

  it('a failed generating reset does not stop the queue from advancing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(session.prompt)
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(undefined);
    // Only the reset to false fails; the set-to-true before delivery succeeds.
    vi.mocked(repo.setGenerating).mockImplementation(async (_id, isGenerating) => {
      if (!isGenerating) throw new Error('backend down');
    });

    await expect(
      drain(
        makeBatch([
          { seq: 1, content: 'first' },
          { seq: 2, content: 'second' },
        ])
      )
    ).resolves.toBeUndefined();

    expect(repo.markTurnProcessed).toHaveBeenCalledWith(ROW_ID, 2);
    expect(session.prompt).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
});
