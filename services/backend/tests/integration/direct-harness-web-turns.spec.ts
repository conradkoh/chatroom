/**
 * Direct Harness — Web Turns Endpoint Integration Tests
 *
 * Covers: getLatestTurns, getTurnsSince, getOlderTurns, getStreamingTurnChunks
 */

import { describe, expect, test, beforeEach, afterEach } from 'vitest';

import { featureFlags } from '../../config/featureFlags';
import { api } from '../../convex/_generated/api';
import { t } from '../../test.setup';
import { setupWorkspaceForSession, createSession } from './direct-harness/fixtures';

beforeEach(() => {
  featureFlags.directHarnessWorkers = true;
});

afterEach(() => {
  featureFlags.directHarnessWorkers = false;
});

// ─── getLatestTurns ────────────────────────────────────────────────────────────

describe('turns.getLatestTurns', () => {
  test('returns all turns oldest-to-newest', async () => {
    const { sessionId, workspaceId } = await setupWorkspaceForSession('glt-basic');
    const { sessionId: rowId } = await createSession(sessionId, workspaceId);
    // createSession writes turnSeq=1 (user). Add assistant turn.
    await t.mutation(api.daemon.directHarness.turns.beginAssistantTurn, {
      sessionId,
      harnessSessionId: rowId,
    });

    const result = await t.query(api.web.directHarness.turns.getLatestTurns, {
      sessionId,
      harnessSessionId: rowId,
    });

    expect(result.turns.length).toBe(2);
    expect(result.turns[0]!.role).toBe('user');
    expect(result.turns[1]!.role).toBe('assistant');
    expect(result.turns[0]!.turnSeq).toBeLessThan(result.turns[1]!.turnSeq);
  });

  test('hasMore=true when more than limit rows exist', async () => {
    const { sessionId, workspaceId } = await setupWorkspaceForSession('glt-hasmore');
    const { sessionId: rowId } = await createSession(sessionId, workspaceId);

    // Add more turns to exceed limit=2
    for (let i = 0; i < 3; i++) {
      await t.mutation(api.daemon.directHarness.turns.beginAssistantTurn, {
        sessionId,
        harnessSessionId: rowId,
      });
    }

    const result = await t.query(api.web.directHarness.turns.getLatestTurns, {
      sessionId,
      harnessSessionId: rowId,
      limit: 2,
    });

    expect(result.hasMore).toBe(true);
    expect(result.turns.length).toBe(2);
  });

  test('hasMore=false when all rows fit within limit', async () => {
    const { sessionId, workspaceId } = await setupWorkspaceForSession('glt-nomore');
    const { sessionId: rowId } = await createSession(sessionId, workspaceId);

    const result = await t.query(api.web.directHarness.turns.getLatestTurns, {
      sessionId,
      harnessSessionId: rowId,
    });

    expect(result.hasMore).toBe(false);
  });

  test('newestTurnSeq is the seq of the last turn', async () => {
    const { sessionId, workspaceId } = await setupWorkspaceForSession('glt-newest');
    const { sessionId: rowId } = await createSession(sessionId, workspaceId);

    const result = await t.query(api.web.directHarness.turns.getLatestTurns, {
      sessionId,
      harnessSessionId: rowId,
    });

    expect(result.newestTurnSeq).toBe(result.turns[result.turns.length - 1]!.turnSeq);
  });

  test('turn rows do not expose harnessSessionId', async () => {
    const { sessionId, workspaceId } = await setupWorkspaceForSession('glt-nohsid');
    const { sessionId: rowId } = await createSession(sessionId, workspaceId);

    const result = await t.query(api.web.directHarness.turns.getLatestTurns, {
      sessionId,
      harnessSessionId: rowId,
    });

    for (const turn of result.turns) {
      expect(turn).not.toHaveProperty('harnessSessionId');
    }
  });
});

// ─── getTurnsSince ─────────────────────────────────────────────────────────────

describe('turns.getTurnsSince', () => {
  test('returns turns with turnSeq > afterTurnSeq', async () => {
    const { sessionId, workspaceId } = await setupWorkspaceForSession('gts-basic');
    const { sessionId: rowId } = await createSession(sessionId, workspaceId);

    // turnSeq=1 exists from createSession. Add a second turn.
    await t.mutation(api.daemon.directHarness.turns.beginAssistantTurn, {
      sessionId,
      harnessSessionId: rowId,
    });

    // Only return turns after seq=1 → should be the assistant turn at seq=2
    const result = await t.query(api.web.directHarness.turns.getTurnsSince, {
      sessionId,
      harnessSessionId: rowId,
      afterTurnSeq: 1,
    });

    expect(result.length).toBe(1);
    expect(result[0]!.role).toBe('assistant');
    expect(result[0]!.turnSeq).toBe(2);
  });

  test('returns empty array when nothing is newer than afterTurnSeq', async () => {
    const { sessionId, workspaceId } = await setupWorkspaceForSession('gts-empty');
    const { sessionId: rowId } = await createSession(sessionId, workspaceId);

    const result = await t.query(api.web.directHarness.turns.getTurnsSince, {
      sessionId,
      harnessSessionId: rowId,
      afterTurnSeq: 999,
    });

    expect(result).toHaveLength(0);
  });

  test('reflects status update on an existing turn', async () => {
    const { sessionId, workspaceId } = await setupWorkspaceForSession('gts-status');
    const { sessionId: rowId } = await createSession(sessionId, workspaceId);

    const { turnId } = await t.mutation(api.daemon.directHarness.turns.beginAssistantTurn, {
      sessionId,
      harnessSessionId: rowId,
    });

    // Manually update status to 'complete'
    await t.run(async (ctx) => {
      await ctx.db.patch(turnId, { status: 'complete', textContent: 'done' });
    });

    // getTurnsSince from before the assistant turn should return it with updated status
    const result = await t.query(api.web.directHarness.turns.getTurnsSince, {
      sessionId,
      harnessSessionId: rowId,
      afterTurnSeq: 1,
    });

    expect(result).toHaveLength(1);
    expect(result[0]!.status).toBe('complete');
    expect(result[0]!.textContent).toBe('done');
  });
});

// ─── getOlderTurns ─────────────────────────────────────────────────────────────

describe('turns.getOlderTurns', () => {
  test('returns turns before beforeTurnSeq oldest-to-newest', async () => {
    const { sessionId, workspaceId } = await setupWorkspaceForSession('got-basic');
    const { sessionId: rowId } = await createSession(sessionId, workspaceId);

    // Add more turns: seqs 1(user from createSession), 2(assistant), 3(assistant)
    await t.mutation(api.daemon.directHarness.turns.beginAssistantTurn, {
      sessionId,
      harnessSessionId: rowId,
    });
    await t.mutation(api.daemon.directHarness.turns.beginAssistantTurn, {
      sessionId,
      harnessSessionId: rowId,
    });

    // Request turns before seq=3
    const result = await t.query(api.web.directHarness.turns.getOlderTurns, {
      sessionId,
      harnessSessionId: rowId,
      beforeTurnSeq: 3,
    });

    expect(result.turns.length).toBe(2);
    expect(result.turns[0]!.turnSeq).toBe(1);
    expect(result.turns[1]!.turnSeq).toBe(2);
  });

  test('hasMore=true when more older turns exist', async () => {
    const { sessionId, workspaceId } = await setupWorkspaceForSession('got-hasmore');
    const { sessionId: rowId } = await createSession(sessionId, workspaceId);

    // Add 3 extra turns (total 4 turns: seqs 1,2,3,4)
    for (let i = 0; i < 3; i++) {
      await t.mutation(api.daemon.directHarness.turns.beginAssistantTurn, {
        sessionId,
        harnessSessionId: rowId,
      });
    }

    // Request at most 2 turns before seq=4 → seqs 1,2,3 available; limit=2 → hasMore=true
    const result = await t.query(api.web.directHarness.turns.getOlderTurns, {
      sessionId,
      harnessSessionId: rowId,
      beforeTurnSeq: 4,
      limit: 2,
    });

    expect(result.hasMore).toBe(true);
    expect(result.turns.length).toBe(2);
  });
});

// ─── getStreamingTurnChunks ────────────────────────────────────────────────────

describe('turns.getStreamingTurnChunks', () => {
  test('returns chunks ordered by seq for a given messageId', async () => {
    const { sessionId, workspaceId } = await setupWorkspaceForSession('gstc-basic');
    const { sessionId: rowId } = await createSession(sessionId, workspaceId);

    const testMessageId = 'msg-test-123';

    // Append chunks via the daemon appendMessages endpoint
    await t.mutation(api.daemon.directHarness.messages.appendMessages, {
      sessionId,
      harnessSessionId: rowId,
      chunks: [
        { content: 'token1', timestamp: 1000, messageId: testMessageId },
        { content: 'token2', timestamp: 1001, messageId: testMessageId },
        { content: 'token3', timestamp: 1002, messageId: testMessageId },
      ],
    });

    const chunks = await t.query(api.web.directHarness.turns.getStreamingTurnChunks, {
      sessionId,
      harnessSessionId: rowId,
      messageId: testMessageId,
    });

    expect(chunks).toHaveLength(3);
    expect(chunks[0]!.content).toBe('token1');
    expect(chunks[1]!.content).toBe('token2');
    expect(chunks[2]!.content).toBe('token3');
    // Verify ordering by _creationTime (seq no longer populated on new rows)
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i]!._creationTime).toBeGreaterThanOrEqual(chunks[i - 1]!._creationTime);
    }
  });

  test('returns empty array when no chunks exist for messageId', async () => {
    const { sessionId, workspaceId } = await setupWorkspaceForSession('gstc-empty');
    const { sessionId: rowId } = await createSession(sessionId, workspaceId);

    const chunks = await t.query(api.web.directHarness.turns.getStreamingTurnChunks, {
      sessionId,
      harnessSessionId: rowId,
      messageId: 'nonexistent-msg-id',
    });

    expect(chunks).toHaveLength(0);
  });

  test('only returns chunks with the given messageId', async () => {
    const { sessionId, workspaceId } = await setupWorkspaceForSession('gstc-filter');
    const { sessionId: rowId } = await createSession(sessionId, workspaceId);

    const msgIdA = 'msg-a';
    const msgIdB = 'msg-b';

    await t.mutation(api.daemon.directHarness.messages.appendMessages, {
      sessionId,
      harnessSessionId: rowId,
      chunks: [
        { content: 'from-a', timestamp: 1000, messageId: msgIdA },
        { content: 'from-b', timestamp: 1001, messageId: msgIdB },
      ],
    });

    const chunksA = await t.query(api.web.directHarness.turns.getStreamingTurnChunks, {
      sessionId,
      harnessSessionId: rowId,
      messageId: msgIdA,
    });

    expect(chunksA).toHaveLength(1);
    expect(chunksA[0]!.content).toBe('from-a');
  });

  // ─── afterCreationTime cursor tests ──────────────────────────────────────

  test('without afterCreationTime: returns latest chunks in asc order (initial load)', async () => {
    const { sessionId, workspaceId } = await setupWorkspaceForSession('gstc-cursor-none');
    const { sessionId: rowId } = await createSession(sessionId, workspaceId);

    const testMessageId = 'msg-cursor-none';
    await t.mutation(api.daemon.directHarness.messages.appendMessages, {
      sessionId,
      harnessSessionId: rowId,
      chunks: [
        { content: 'alpha', timestamp: 1000, messageId: testMessageId },
        { content: 'beta', timestamp: 1001, messageId: testMessageId },
        { content: 'gamma', timestamp: 1002, messageId: testMessageId },
      ],
    });

    const chunks = await t.query(api.web.directHarness.turns.getStreamingTurnChunks, {
      sessionId,
      harnessSessionId: rowId,
      messageId: testMessageId,
      // no afterCreationTime → legacy path
    });

    expect(chunks).toHaveLength(3);
    // Must be in ascending _creationTime order
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i]!._creationTime).toBeGreaterThanOrEqual(chunks[i - 1]!._creationTime);
    }
  });

  test('with afterCreationTime equal to highest seen: returns only newer + same-time chunks', async () => {
    const { sessionId, workspaceId } = await setupWorkspaceForSession('gstc-cursor-top');
    const { sessionId: rowId } = await createSession(sessionId, workspaceId);

    const testMessageId = 'msg-cursor-top';
    await t.mutation(api.daemon.directHarness.messages.appendMessages, {
      sessionId,
      harnessSessionId: rowId,
      chunks: [
        { content: 'old1', timestamp: 1000, messageId: testMessageId },
        { content: 'old2', timestamp: 1001, messageId: testMessageId },
        { content: 'new1', timestamp: 1002, messageId: testMessageId },
      ],
    });

    // Fetch all first so we know the actual _creationTime of the last chunk
    const allChunks = await t.query(api.web.directHarness.turns.getStreamingTurnChunks, {
      sessionId,
      harnessSessionId: rowId,
      messageId: testMessageId,
    });
    expect(allChunks).toHaveLength(3);
    const highestCreationTime = allChunks[allChunks.length - 1]!._creationTime;

    // Cursor at the highest seen — should return at least 'new1' (gte, not gt)
    const chunks = await t.query(api.web.directHarness.turns.getStreamingTurnChunks, {
      sessionId,
      harnessSessionId: rowId,
      messageId: testMessageId,
      afterCreationTime: highestCreationTime,
    });

    // gte: 'new1' (the chunk at highestCreationTime) must be included
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks[chunks.length - 1]!.content).toBe('new1');
    // Must be ascending
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i]!._creationTime).toBeGreaterThanOrEqual(chunks[i - 1]!._creationTime);
    }
  });

  test('with afterCreationTime past all chunks: returns empty array', async () => {
    const { sessionId, workspaceId } = await setupWorkspaceForSession('gstc-cursor-past');
    const { sessionId: rowId } = await createSession(sessionId, workspaceId);

    const testMessageId = 'msg-cursor-past';
    await t.mutation(api.daemon.directHarness.messages.appendMessages, {
      sessionId,
      harnessSessionId: rowId,
      chunks: [{ content: 'only', timestamp: 1000, messageId: testMessageId }],
    });

    // Use a far-future timestamp so nothing matches
    const farFuture = Date.now() + 1_000_000_000;
    const chunks = await t.query(api.web.directHarness.turns.getStreamingTurnChunks, {
      sessionId,
      harnessSessionId: rowId,
      messageId: testMessageId,
      afterCreationTime: farFuture,
    });

    expect(chunks).toHaveLength(0);
  });

  test('with afterCreationTime older than oldest: returns all chunks asc, capped at limit', async () => {
    const { sessionId, workspaceId } = await setupWorkspaceForSession('gstc-cursor-before-all');
    const { sessionId: rowId } = await createSession(sessionId, workspaceId);

    const testMessageId = 'msg-cursor-before-all';
    await t.mutation(api.daemon.directHarness.messages.appendMessages, {
      sessionId,
      harnessSessionId: rowId,
      chunks: [
        { content: 'x1', timestamp: 1000, messageId: testMessageId },
        { content: 'x2', timestamp: 1001, messageId: testMessageId },
        { content: 'x3', timestamp: 1002, messageId: testMessageId },
        { content: 'x4', timestamp: 1003, messageId: testMessageId },
        { content: 'x5', timestamp: 1004, messageId: testMessageId },
      ],
    });

    // Cursor at epoch 0 — older than all chunks — with limit=3
    const chunks = await t.query(api.web.directHarness.turns.getStreamingTurnChunks, {
      sessionId,
      harnessSessionId: rowId,
      messageId: testMessageId,
      afterCreationTime: 0,
      limit: 3,
    });

    // Cursor path with gte(0): all 5 chunks match, but limit=3 → oldest 3 in asc order
    expect(chunks).toHaveLength(3);
    expect(chunks[0]!.content).toBe('x1');
    expect(chunks[1]!.content).toBe('x2');
    expect(chunks[2]!.content).toBe('x3');
    // Ascending order
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i]!._creationTime).toBeGreaterThanOrEqual(chunks[i - 1]!._creationTime);
    }
  });

  test('respects the limit parameter — returns only the newest N chunks in _creationTime order', async () => {
    const { sessionId, workspaceId } = await setupWorkspaceForSession('gstc-limit');
    const { sessionId: rowId } = await createSession(sessionId, workspaceId);

    const testMessageId = 'msg-limit-test';

    // Insert 5 chunks
    await t.mutation(api.daemon.directHarness.messages.appendMessages, {
      sessionId,
      harnessSessionId: rowId,
      chunks: [
        { content: 'a', timestamp: 1000, messageId: testMessageId },
        { content: 'b', timestamp: 1001, messageId: testMessageId },
        { content: 'c', timestamp: 1002, messageId: testMessageId },
        { content: 'd', timestamp: 1003, messageId: testMessageId },
        { content: 'e', timestamp: 1004, messageId: testMessageId },
      ],
    });

    // Request only the newest 3
    const chunks = await t.query(api.web.directHarness.turns.getStreamingTurnChunks, {
      sessionId,
      harnessSessionId: rowId,
      messageId: testMessageId,
      limit: 3,
    });

    expect(chunks).toHaveLength(3);
    // Should return the NEWEST 3 (c, d, e) in ascending _creationTime order
    expect(chunks[0]!.content).toBe('c');
    expect(chunks[1]!.content).toBe('d');
    expect(chunks[2]!.content).toBe('e');
    // Verify ascending _creationTime order
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i]!._creationTime).toBeGreaterThanOrEqual(chunks[i - 1]!._creationTime);
    }
  });
});
