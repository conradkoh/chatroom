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
