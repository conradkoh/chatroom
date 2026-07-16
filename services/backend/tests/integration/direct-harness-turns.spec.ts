/**
 * Direct Harness — Turns Integration Tests
 *
 * Covers: beginAssistantTurn, bindTurnMessageId, finalizeAssistantTurn
 */

import { describe, expect, test, beforeEach, afterEach } from 'vitest';

import { featureFlags } from '../../config/featureFlags';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { t } from '../../test.setup';
import { setupWorkspaceForSession, createSession } from './direct-harness/fixtures';
import { createTestSession } from '../helpers/integration';

// ─── Flag management ──────────────────────────────────────────────────────────

beforeEach(() => {
  featureFlags.directHarnessWorkers = true;
});

afterEach(() => {
  featureFlags.directHarnessWorkers = false;
});

// ─── beginAssistantTurn ──────────────────────────────────────────────────────

describe('turns.beginAssistantTurn', () => {
  test('allocates turnSeq=2 for first assistant turn (after createSession user turn at 1)', async () => {
    const { sessionId, workspaceId } = await setupWorkspaceForSession('begin-first');
    const { sessionId: rowId } = await createSession(sessionId, workspaceId);

    const result = await t.mutation(api.daemon.directHarness.turns.beginAssistantTurn, {
      sessionId,
      harnessSessionId: rowId,
    });

    expect(result.turnSeq).toBe(2); // user turn is turnSeq=1, assistant is turnSeq=2
    expect(result.turnId).toBeDefined();
  });

  test('allocates sequential turnSeqs', async () => {
    const { sessionId, workspaceId } = await setupWorkspaceForSession('begin-second');
    const { sessionId: rowId } = await createSession(sessionId, workspaceId);

    const first = await t.mutation(api.daemon.directHarness.turns.beginAssistantTurn, {
      sessionId,
      harnessSessionId: rowId,
    });
    const second = await t.mutation(api.daemon.directHarness.turns.beginAssistantTurn, {
      sessionId,
      harnessSessionId: rowId,
    });

    expect(second.turnSeq).toBe(first.turnSeq + 1);
    expect(first.turnId).not.toBe(second.turnId);
  });

  test('both turns are pending after creation', async () => {
    const { sessionId, workspaceId } = await setupWorkspaceForSession('begin-pending');
    const { sessionId: rowId } = await createSession(sessionId, workspaceId);

    const first = await t.mutation(api.daemon.directHarness.turns.beginAssistantTurn, {
      sessionId,
      harnessSessionId: rowId,
    });
    const second = await t.mutation(api.daemon.directHarness.turns.beginAssistantTurn, {
      sessionId,
      harnessSessionId: rowId,
    });

    const [firstRow, secondRow] = await Promise.all([
      t.run(async (ctx) => ctx.db.get(first.turnId as Id<'chatroom_harnessSessionTurns'>)),
      t.run(async (ctx) => ctx.db.get(second.turnId as Id<'chatroom_harnessSessionTurns'>)),
    ]);

    expect(firstRow?.status).toBe('pending');
    expect(secondRow?.status).toBe('pending');
  });
});

// ─── bindTurnMessageId ───────────────────────────────────────────────────────

describe('turns.bindTurnMessageId', () => {
  test('flips pending → streaming and sets messageId', async () => {
    const { sessionId, workspaceId } = await setupWorkspaceForSession('bind-streaming');
    const { sessionId: rowId } = await createSession(sessionId, workspaceId);

    const { turnId } = await t.mutation(api.daemon.directHarness.turns.beginAssistantTurn, {
      sessionId,
      harnessSessionId: rowId,
    });

    await t.mutation(api.daemon.directHarness.turns.bindTurnMessageId, {
      sessionId,
      turnId: turnId as Id<'chatroom_harnessSessionTurns'>,
      messageId: 'msg-123',
    });

    const row = await t.run(async (ctx) =>
      ctx.db.get(turnId as Id<'chatroom_harnessSessionTurns'>)
    );
    expect(row?.status).toBe('streaming');
    expect(row?.messageId).toBe('msg-123');
  });

  test('second call (already streaming) is a no-op — messageId unchanged', async () => {
    const { sessionId, workspaceId } = await setupWorkspaceForSession('bind-idempotent');
    const { sessionId: rowId } = await createSession(sessionId, workspaceId);

    const { turnId } = await t.mutation(api.daemon.directHarness.turns.beginAssistantTurn, {
      sessionId,
      harnessSessionId: rowId,
    });

    await t.mutation(api.daemon.directHarness.turns.bindTurnMessageId, {
      sessionId,
      turnId: turnId as Id<'chatroom_harnessSessionTurns'>,
      messageId: 'msg-123',
    });

    // Second call with a different messageId — should be ignored
    await t.mutation(api.daemon.directHarness.turns.bindTurnMessageId, {
      sessionId,
      turnId: turnId as Id<'chatroom_harnessSessionTurns'>,
      messageId: 'msg-different',
    });

    const row = await t.run(async (ctx) =>
      ctx.db.get(turnId as Id<'chatroom_harnessSessionTurns'>)
    );
    // MessageId should still be the original 'msg-123', not 'msg-different'
    expect(row?.messageId).toBe('msg-123');
    expect(row?.status).toBe('streaming');
  });
});

// ─── markTurnProcessed ───────────────────────────────────────────────────────

describe('turns.markTurnProcessed', () => {
  test('patches lastProcessedTurnSeq on the session row', async () => {
    const { sessionId, workspaceId } = await setupWorkspaceForSession('mtp-basic');
    const { sessionId: rowId } = await createSession(sessionId, workspaceId);

    await t.mutation(api.daemon.directHarness.turns.markTurnProcessed, {
      sessionId,
      harnessSessionId: rowId,
      turnSeq: 3,
    });

    const session = await t.run(async (ctx) => ctx.db.get(rowId as Id<'chatroom_harnessSessions'>));
    expect(session?.lastProcessedTurnSeq).toBe(3);
  });

  test('rejects when machine.userId !== auth.userId', async () => {
    // Create a session owned by user A
    const { sessionId: ownerSession, workspaceId } =
      await setupWorkspaceForSession('mtp-unauth-owner');
    const { sessionId: rowId } = await createSession(ownerSession, workspaceId);

    // Create a different user's session
    const { sessionId: otherSession } = await createTestSession('mtp-unauth-other');

    // otherSession belongs to a different user — markTurnProcessed should reject
    await expect(
      t.mutation(api.daemon.directHarness.turns.markTurnProcessed, {
        sessionId: otherSession,
        harnessSessionId: rowId,
        turnSeq: 1,
      })
    ).rejects.toThrow();
  });
});

describe('turns.finalizeAssistantTurn', () => {
  test('aggregates text + reasoning content correctly', async () => {
    const { sessionId, workspaceId } = await setupWorkspaceForSession('finalize-content');
    const { sessionId: rowId } = await createSession(sessionId, workspaceId);

    const { turnId } = await t.mutation(api.daemon.directHarness.turns.beginAssistantTurn, {
      sessionId,
      harnessSessionId: rowId,
    });

    await t.mutation(api.daemon.directHarness.turns.bindTurnMessageId, {
      sessionId,
      turnId: turnId as Id<'chatroom_harnessSessionTurns'>,
      messageId: 'msg-agg',
    });

    // Insert chunks — only 'msg-agg' chunks should be aggregated
    await t.mutation(api.daemon.directHarness.messages.appendMessages, {
      sessionId,
      harnessSessionId: rowId,
      chunks: [
        { content: 'Hello ', timestamp: 1, messageId: 'msg-agg', partType: 'text' },
        { content: 'World', timestamp: 2, messageId: 'msg-agg', partType: 'text' },
        {
          content: '<think>reasoning</think>',
          timestamp: 3,
          messageId: 'msg-agg',
          partType: 'reasoning',
        },
        // Different messageId — still aggregated when in the same turn window
        { content: 'other', timestamp: 4, messageId: 'msg-other', partType: 'text' },
      ],
    });

    await t.mutation(api.daemon.directHarness.turns.finalizeAssistantTurn, {
      sessionId,
      turnId: turnId as Id<'chatroom_harnessSessionTurns'>,
    });

    const row = await t.run(async (ctx) =>
      ctx.db.get(turnId as Id<'chatroom_harnessSessionTurns'>)
    );
    expect(row?.status).toBe('complete');
    expect(row?.textContent).toBe('Hello Worldother');
    expect(row?.reasoningContent).toBe('<think>reasoning</think>');
    expect(row?.completedAt).toBeDefined();
  });

  test('finalizes with empty content when no messageId bound (pending → idle)', async () => {
    const { sessionId, workspaceId } = await setupWorkspaceForSession('finalize-empty');
    const { sessionId: rowId } = await createSession(sessionId, workspaceId);

    const { turnId } = await t.mutation(api.daemon.directHarness.turns.beginAssistantTurn, {
      sessionId,
      harnessSessionId: rowId,
    });

    // No bind — finalize directly from pending
    await t.mutation(api.daemon.directHarness.turns.finalizeAssistantTurn, {
      sessionId,
      turnId: turnId as Id<'chatroom_harnessSessionTurns'>,
    });

    const row = await t.run(async (ctx) =>
      ctx.db.get(turnId as Id<'chatroom_harnessSessionTurns'>)
    );
    expect(row?.status).toBe('complete');
    expect(row?.textContent).toBe('');
    expect(row?.reasoningContent).toBe('');
    expect(row?.completedAt).toBeDefined();
  });

  test('is idempotent: content unchanged and completedAt same on second call', async () => {
    const { sessionId, workspaceId } = await setupWorkspaceForSession('finalize-idempotent');
    const { sessionId: rowId } = await createSession(sessionId, workspaceId);

    const { turnId } = await t.mutation(api.daemon.directHarness.turns.beginAssistantTurn, {
      sessionId,
      harnessSessionId: rowId,
    });

    await t.mutation(api.daemon.directHarness.turns.bindTurnMessageId, {
      sessionId,
      turnId: turnId as Id<'chatroom_harnessSessionTurns'>,
      messageId: 'msg-idem',
    });

    // Insert a chunk so content would be aggregated on first call
    await t.mutation(api.daemon.directHarness.messages.appendMessages, {
      sessionId,
      harnessSessionId: rowId,
      chunks: [{ content: 'once', timestamp: 1, messageId: 'msg-idem', partType: 'text' }],
    });

    // First finalize
    await t.mutation(api.daemon.directHarness.turns.finalizeAssistantTurn, {
      sessionId,
      turnId: turnId as Id<'chatroom_harnessSessionTurns'>,
    });

    const rowAfterFirst = await t.run(async (ctx) =>
      ctx.db.get(turnId as Id<'chatroom_harnessSessionTurns'>)
    );
    const firstCompletedAt = rowAfterFirst?.completedAt;
    expect(rowAfterFirst?.textContent).toBe('once');

    // Second finalize — should be a true no-op
    await t.mutation(api.daemon.directHarness.turns.finalizeAssistantTurn, {
      sessionId,
      turnId: turnId as Id<'chatroom_harnessSessionTurns'>,
    });

    const rowAfterSecond = await t.run(async (ctx) =>
      ctx.db.get(turnId as Id<'chatroom_harnessSessionTurns'>)
    );
    // Content unchanged (not duplicated to 'onceonce')
    expect(rowAfterSecond?.textContent).toBe('once');
    // completedAt unchanged (second call did not re-write the row)
    expect(rowAfterSecond?.completedAt).toBe(firstCompletedAt);
  });
});
