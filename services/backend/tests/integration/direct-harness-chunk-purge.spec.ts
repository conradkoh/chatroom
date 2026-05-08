/**
 * Direct Harness — Chunk Purge Integration Tests
 *
 * Covers purgeFinalizedChunks (cron).
 */

import { describe, expect, test, beforeEach, afterEach } from 'vitest';

import { featureFlags } from '../../config/featureFlags';
import { api, internal } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { t } from '../../test.setup';
import { setupWorkspaceForSession, createSession } from './direct-harness/fixtures';

// ─── Flag management ──────────────────────────────────────────────────────────

beforeEach(() => {
  featureFlags.directHarnessWorkers = true;
});

afterEach(() => {
  featureFlags.directHarnessWorkers = false;
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ONE_HOUR_MS = 60 * 60 * 1000;

async function insertChunksForTurn(
  sessionId: string,
  harnessSessionId: Id<'chatroom_harnessSessions'>,
  messageId: string
) {
  await t.mutation(api.daemon.directHarness.messages.appendMessages, {
    sessionId,
    harnessSessionId,
    chunks: [
      { content: 'chunk1', timestamp: 1, messageId, partType: 'text' },
      { content: 'chunk2', timestamp: 2, messageId, partType: 'text' },
    ],
  });
}

async function countChunksForMessageId(messageId: string): Promise<number> {
  return t.run(async (ctx) => {
    const chunks = await ctx.db
      .query('chatroom_harnessSessionMessages')
      .withIndex('by_messageId', (q) => q.eq('messageId', messageId))
      .collect();
    return chunks.length;
  });
}

async function countAllChunks(): Promise<number> {
  return t.run(async (ctx) => {
    const chunks = await ctx.db.query('chatroom_harnessSessionMessages').collect();
    return chunks.length;
  });
}

// ─── purgeFinalizedChunks ─────────────────────────────────────────────────────

describe('directHarnessCleanup.purgeFinalizedChunks', () => {
  test('complete turn with completedAt > 1h ago: chunks deleted, turn untouched', async () => {
    const { sessionId, workspaceId } = await setupWorkspaceForSession('purge-complete-old');
    const { sessionId: rowId } = await createSession(sessionId, workspaceId);

    const { turnId } = await t.mutation(api.daemon.directHarness.turns.beginAssistantTurn, {
      sessionId,
      harnessSessionId: rowId,
    });
    await t.mutation(api.daemon.directHarness.turns.bindTurnMessageId, {
      sessionId,
      turnId: turnId as Id<'chatroom_harnessSessionTurns'>,
      messageId: 'msg-purge-old',
    });
    await insertChunksForTurn(sessionId, rowId, 'msg-purge-old');
    await t.mutation(api.daemon.directHarness.turns.finalizeAssistantTurn, {
      sessionId,
      turnId: turnId as Id<'chatroom_harnessSessionTurns'>,
    });

    // Backdate completedAt to > 1h ago
    await t.run(async (ctx) => {
      await ctx.db.patch(turnId as Id<'chatroom_harnessSessionTurns'>, {
        completedAt: Date.now() - ONE_HOUR_MS - 1000,
      });
    });

    const result = await t.mutation(internal.directHarnessCleanup.purgeFinalizedChunks, {});

    expect(result.chunksDeleted).toBe(2);
    expect(result.turnsScanned).toBeGreaterThanOrEqual(1);

    // Chunks should be gone
    expect(await countChunksForMessageId('msg-purge-old')).toBe(0);

    // Turn should still exist and be complete
    const turn = await t.run(async (ctx) =>
      ctx.db.get(turnId as Id<'chatroom_harnessSessionTurns'>)
    );
    expect(turn?.status).toBe('complete');
  });

  test('failed turn with completedAt > 1h ago: chunks deleted', async () => {
    const { sessionId, workspaceId, machineId } =
      await setupWorkspaceForSession('purge-failed-old');
    const { sessionId: rowId } = await createSession(sessionId, workspaceId);

    const { turnId } = await t.mutation(api.daemon.directHarness.turns.beginAssistantTurn, {
      sessionId,
      harnessSessionId: rowId,
    });
    await t.mutation(api.daemon.directHarness.turns.bindTurnMessageId, {
      sessionId,
      turnId: turnId as Id<'chatroom_harnessSessionTurns'>,
      messageId: 'msg-purge-failed',
    });
    await insertChunksForTurn(sessionId, rowId, 'msg-purge-failed');

    // Mark orphan (flips to failed)
    await t.mutation(api.daemon.directHarness.turns.markOrphanTurnsFailed, {
      sessionId,
      machineId,
      harnessSessionId: rowId,
    });

    // Backdate completedAt
    await t.run(async (ctx) => {
      await ctx.db.patch(turnId as Id<'chatroom_harnessSessionTurns'>, {
        completedAt: Date.now() - ONE_HOUR_MS - 1000,
      });
    });

    const result = await t.mutation(internal.directHarnessCleanup.purgeFinalizedChunks, {});

    expect(result.chunksDeleted).toBe(2);
    expect(await countChunksForMessageId('msg-purge-failed')).toBe(0);
  });

  test('complete turn with completedAt < 1h ago: chunks PRESERVED', async () => {
    const { sessionId, workspaceId } = await setupWorkspaceForSession('purge-complete-recent');
    const { sessionId: rowId } = await createSession(sessionId, workspaceId);

    const { turnId } = await t.mutation(api.daemon.directHarness.turns.beginAssistantTurn, {
      sessionId,
      harnessSessionId: rowId,
    });
    await t.mutation(api.daemon.directHarness.turns.bindTurnMessageId, {
      sessionId,
      turnId: turnId as Id<'chatroom_harnessSessionTurns'>,
      messageId: 'msg-purge-recent',
    });
    await insertChunksForTurn(sessionId, rowId, 'msg-purge-recent');
    await t.mutation(api.daemon.directHarness.turns.finalizeAssistantTurn, {
      sessionId,
      turnId: turnId as Id<'chatroom_harnessSessionTurns'>,
    });
    // completedAt is recent (just set by finalize) — do NOT backdate

    const chunksBefore = await countChunksForMessageId('msg-purge-recent');
    expect(chunksBefore).toBe(2);

    const result = await t.mutation(internal.directHarnessCleanup.purgeFinalizedChunks, {});

    // This recent turn should not be deleted
    const chunksAfter = await countChunksForMessageId('msg-purge-recent');
    expect(chunksAfter).toBe(2);
    // Check chunksDeleted doesn't include these
    expect(result.chunksDeleted).toBe(0);
  });

  test('streaming turn: chunks PRESERVED', async () => {
    const { sessionId, workspaceId } = await setupWorkspaceForSession('purge-streaming');
    const { sessionId: rowId } = await createSession(sessionId, workspaceId);

    const { turnId } = await t.mutation(api.daemon.directHarness.turns.beginAssistantTurn, {
      sessionId,
      harnessSessionId: rowId,
    });
    await t.mutation(api.daemon.directHarness.turns.bindTurnMessageId, {
      sessionId,
      turnId: turnId as Id<'chatroom_harnessSessionTurns'>,
      messageId: 'msg-streaming',
    });
    await insertChunksForTurn(sessionId, rowId, 'msg-streaming');
    // Do not finalize — turn stays streaming

    const result = await t.mutation(internal.directHarnessCleanup.purgeFinalizedChunks, {});

    expect(result.chunksDeleted).toBe(0);
    expect(await countChunksForMessageId('msg-streaming')).toBe(2);
  });

  test('pending turn: chunks PRESERVED (no messageId)', async () => {
    const { sessionId, workspaceId } = await setupWorkspaceForSession('purge-pending');
    const { sessionId: rowId } = await createSession(sessionId, workspaceId);

    await t.mutation(api.daemon.directHarness.turns.beginAssistantTurn, {
      sessionId,
      harnessSessionId: rowId,
    });
    // No bind, no finalize — turn stays pending

    const result = await t.mutation(internal.directHarnessCleanup.purgeFinalizedChunks, {});

    expect(result.chunksDeleted).toBe(0);
  });

  test('complete turn without messageId: no error, skipped gracefully', async () => {
    const { sessionId, workspaceId } = await setupWorkspaceForSession('purge-no-msgid');
    const { sessionId: rowId } = await createSession(sessionId, workspaceId);

    const { turnId } = await t.mutation(api.daemon.directHarness.turns.beginAssistantTurn, {
      sessionId,
      harnessSessionId: rowId,
    });
    // Finalize without binding messageId
    await t.mutation(api.daemon.directHarness.turns.finalizeAssistantTurn, {
      sessionId,
      turnId: turnId as Id<'chatroom_harnessSessionTurns'>,
    });

    await t.run(async (ctx) => {
      await ctx.db.patch(turnId as Id<'chatroom_harnessSessionTurns'>, {
        completedAt: Date.now() - ONE_HOUR_MS - 1000,
      });
    });

    const result = await t.mutation(internal.directHarnessCleanup.purgeFinalizedChunks, {});

    // No error, turn without messageId just produces 0 chunk deletions
    expect(result.chunksDeleted).toBe(0);
    expect(result.turnsScanned).toBeGreaterThanOrEqual(1);
  });

  test('returns correct counts', async () => {
    const { sessionId, workspaceId } = await setupWorkspaceForSession('purge-counts');
    const { sessionId: rowId } = await createSession(sessionId, workspaceId);

    // Create 2 old complete turns
    for (let i = 0; i < 2; i++) {
      const { turnId } = await t.mutation(api.daemon.directHarness.turns.beginAssistantTurn, {
        sessionId,
        harnessSessionId: rowId,
      });
      const msgId = `msg-count-${i}`;
      await t.mutation(api.daemon.directHarness.turns.bindTurnMessageId, {
        sessionId,
        turnId: turnId as Id<'chatroom_harnessSessionTurns'>,
        messageId: msgId,
      });
      await insertChunksForTurn(sessionId, rowId, msgId); // 2 chunks each
      await t.mutation(api.daemon.directHarness.turns.finalizeAssistantTurn, {
        sessionId,
        turnId: turnId as Id<'chatroom_harnessSessionTurns'>,
      });
      await t.run(async (ctx) => {
        await ctx.db.patch(turnId as Id<'chatroom_harnessSessionTurns'>, {
          completedAt: Date.now() - ONE_HOUR_MS - 1000,
        });
      });
    }

    const result = await t.mutation(internal.directHarnessCleanup.purgeFinalizedChunks, {});

    expect(result.turnsScanned).toBeGreaterThanOrEqual(2);
    expect(result.chunksDeleted).toBeGreaterThanOrEqual(4); // 2 turns × 2 chunks
  });
});
