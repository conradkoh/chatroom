/**
 * Direct Harness — Messages Integration Tests
 *
 * Covers: send (frontend), subscribe (frontend), appendMessages (daemon),
 * pendingForMachine (daemon)
 */

import { describe, expect, test, beforeEach, afterEach } from 'vitest';

import { featureFlags } from '../../config/featureFlags';
import { api } from '../../convex/_generated/api';
import { t } from '../../test.setup';
import { setupWorkspaceForSession, createSession } from './direct-harness/fixtures';

// ─── Flag management ──────────────────────────────────────────────────────────

beforeEach(() => {
  featureFlags.directHarnessWorkers = true;
});

afterEach(() => {
  featureFlags.directHarnessWorkers = false;
});

// Helper: simulate the daemon having processed the initial message from createSession.
// This unblocks subsequent web sends so they route to the turn table instead of the queue.
async function advancePastInitial(
  sessionId: Parameters<typeof t.mutation>[1]['sessionId'],
  rowId: Parameters<typeof t.mutation>[1]['harnessSessionId']
) {
  await t.mutation(api.daemon.directHarness.turns.markTurnProcessed, {
    sessionId,
    harnessSessionId: rowId,
    turnSeq: 1, // initial message from createSession is always turnSeq=1
  });
}

// ─── send ────────────────────────────────────────────────────────────────────

describe('messages.send', () => {
  test('appends a user message and returns turnSeq', async () => {
    const { sessionId, workspaceId } = await setupWorkspaceForSession('send-success');
    const { sessionId: rowId } = await createSession(sessionId, workspaceId);
    await advancePastInitial(sessionId, rowId);

    const result = await t.mutation(api.web.directHarness.messages.send, {
      sessionId,
      harnessSessionId: rowId,
      text: 'hello',
    });

    expect(result.turnSeq).toBeGreaterThan(0);
  });

  test('message appears in turn table', async () => {
    const { sessionId, workspaceId } = await setupWorkspaceForSession('send-visible');
    const { sessionId: rowId } = await createSession(sessionId, workspaceId);
    await advancePastInitial(sessionId, rowId);

    await t.mutation(api.web.directHarness.messages.send, {
      sessionId,
      harnessSessionId: rowId,
      text: 'hello',
    });

    const turns = await t.run(async (ctx) =>
      ctx.db
        .query('chatroom_harnessSessionTurns')
        .withIndex('by_session_turnSeq', (q) => q.eq('harnessSessionId', rowId))
        .order('asc')
        .collect()
    );

    const userTurns = turns.filter((t) => t.role === 'user');
    expect(userTurns.length).toBeGreaterThanOrEqual(2); // first msg + "hello"
    expect(userTurns[userTurns.length - 1]?.textContent).toBe('hello');
  });

  test('throws when session is closed', async () => {
    const { sessionId, workspaceId } = await setupWorkspaceForSession('send-closed');
    const { sessionId: rowId } = await createSession(sessionId, workspaceId);

    await t.mutation(api.daemon.directHarness.sessions.closeSession, {
      sessionId,
      harnessSessionId: rowId,
    });

    await expect(
      t.mutation(api.web.directHarness.messages.send, {
        sessionId,
        harnessSessionId: rowId,
        text: 'too late',
      })
    ).rejects.toThrow();
  });

  test('throws when message is empty', async () => {
    const { sessionId, workspaceId } = await setupWorkspaceForSession('send-empty');
    const { sessionId: rowId } = await createSession(sessionId, workspaceId);

    await expect(
      t.mutation(api.web.directHarness.messages.send, {
        sessionId,
        harnessSessionId: rowId,
        text: '',
      })
    ).rejects.toThrow();
  });
});

// ─── subscribe ───────────────────────────────────────────────────────────────

describe('messages.subscribe', () => {
  test('returns all assistant chunks without afterSeq', async () => {
    const { sessionId, workspaceId } = await setupWorkspaceForSession('sub-all');
    const { sessionId: rowId } = await createSession(sessionId, workspaceId);

    await t.mutation(api.daemon.directHarness.messages.appendMessages, {
      sessionId,
      harnessSessionId: rowId,
      chunks: [
        { content: 'chunk1', timestamp: 1000 },
        { content: 'chunk2', timestamp: 1001 },
      ],
    });

    const messages = await t.query(api.web.directHarness.messages.subscribe, {
      sessionId,
      harnessSessionId: rowId,
    });

    expect(messages.length).toBeGreaterThanOrEqual(2); // chunk1 + chunk2
  });

  test('returns only deltas after afterSeq for assistant chunks', async () => {
    const { sessionId, workspaceId } = await setupWorkspaceForSession('sub-delta');
    const { sessionId: rowId } = await createSession(sessionId, workspaceId);

    // Insert two chunks
    await t.mutation(api.daemon.directHarness.messages.appendMessages, {
      sessionId,
      harnessSessionId: rowId,
      chunks: [{ content: 'before', timestamp: 1000 }],
    });

    const allMessages = await t.query(api.web.directHarness.messages.subscribe, {
      sessionId,
      harnessSessionId: rowId,
    });
    const afterSeq = allMessages[allMessages.length - 1]!.seq;

    await t.mutation(api.daemon.directHarness.messages.appendMessages, {
      sessionId,
      harnessSessionId: rowId,
      chunks: [{ content: 'after', timestamp: 1001 }],
    });

    const deltas = await t.query(api.web.directHarness.messages.subscribe, {
      sessionId,
      harnessSessionId: rowId,
      afterSeq,
    });

    expect(deltas).toHaveLength(1);
    expect(deltas[0]?.content).toBe('after');
  });
});

// ─── appendMessages ──────────────────────────────────────────────────────────

describe('messages.appendMessages', () => {
  test('inserts assistant chunks and returns count', async () => {
    const { sessionId, workspaceId } = await setupWorkspaceForSession('append-success');
    const { sessionId: rowId } = await createSession(sessionId, workspaceId);

    const result = await t.mutation(api.daemon.directHarness.messages.appendMessages, {
      sessionId,
      harnessSessionId: rowId,
      chunks: [
        { content: 'Hello', timestamp: 1000 },
        { content: ' world', timestamp: 1001 },
      ],
    });

    expect(result.inserted).toBe(2);
  });

  test('chunks are stored with role assistant', async () => {
    const { sessionId, workspaceId } = await setupWorkspaceForSession('append-role');
    const { sessionId: rowId } = await createSession(sessionId, workspaceId);

    await t.mutation(api.daemon.directHarness.messages.appendMessages, {
      sessionId,
      harnessSessionId: rowId,
      chunks: [{ content: 'response', timestamp: 1000 }],
    });

    const messages = await t.query(api.web.directHarness.messages.subscribe, {
      sessionId,
      harnessSessionId: rowId,
    });

    const assistant = messages.find((m) => m.role === 'assistant');
    expect(assistant).toBeDefined();
    expect(assistant?.content).toBe('response');
  });

  test('seqs are assigned without collision', async () => {
    const { sessionId, workspaceId } = await setupWorkspaceForSession('append-seq');
    const { sessionId: rowId } = await createSession(sessionId, workspaceId);

    await t.mutation(api.daemon.directHarness.messages.appendMessages, {
      sessionId,
      harnessSessionId: rowId,
      chunks: [
        { content: 'chunk-a', timestamp: 1000 },
        { content: 'chunk-b', timestamp: 1001 },
      ],
    });

    const messages = await t.query(api.web.directHarness.messages.subscribe, {
      sessionId,
      harnessSessionId: rowId,
    });

    const seqs = messages.map((m) => m.seq);
    // All seqs must be unique
    expect(new Set(seqs).size).toBe(seqs.length);
    // 2 assistant chunks
    expect(messages.length).toBe(2);
  });

  test('messageId and partType are stored and returned by subscribe', async () => {
    const { sessionId, workspaceId } = await setupWorkspaceForSession('append-metadata');
    const { sessionId: rowId } = await createSession(sessionId, workspaceId);

    await t.mutation(api.daemon.directHarness.messages.appendMessages, {
      sessionId,
      harnessSessionId: rowId,
      chunks: [
        { content: 'thinking...', timestamp: 1000, messageId: 'msg-1', partType: 'reasoning' },
        { content: 'Hello!', timestamp: 1001, messageId: 'msg-1', partType: 'text' },
      ],
    });

    const messages = await t.query(api.web.directHarness.messages.subscribe, {
      sessionId,
      harnessSessionId: rowId,
    });

    const assistant = messages.filter((m) => m.role === 'assistant');
    expect(assistant).toHaveLength(2);

    const thinking = assistant.find((m) => m.partType === 'reasoning');
    expect(thinking).toBeDefined();
    expect(thinking?.content).toBe('thinking...');
    expect(thinking?.messageId).toBe('msg-1');

    const text = assistant.find((m) => m.partType === 'text');
    expect(text).toBeDefined();
    expect(text?.content).toBe('Hello!');
    expect(text?.messageId).toBe('msg-1');
  });

  test('chunks without messageId/partType are stored with those fields absent', async () => {
    const { sessionId, workspaceId } = await setupWorkspaceForSession('append-no-metadata');
    const { sessionId: rowId } = await createSession(sessionId, workspaceId);

    await t.mutation(api.daemon.directHarness.messages.appendMessages, {
      sessionId,
      harnessSessionId: rowId,
      chunks: [{ content: 'legacy', timestamp: 1000 }],
    });

    const messages = await t.query(api.web.directHarness.messages.subscribe, {
      sessionId,
      harnessSessionId: rowId,
    });

    const assistant = messages.find((m) => m.role === 'assistant');
    expect(assistant).toBeDefined();
    expect(assistant?.messageId).toBeUndefined();
    expect(assistant?.partType).toBeUndefined();
  });
});

// ─── pendingForMachine ───────────────────────────────────────────────────────

describe('messages.pendingForMachine', () => {
  test('returns unprocessed user messages', async () => {
    const { sessionId, machineId, workspaceId } = await setupWorkspaceForSession('pfm-basic');
    const { sessionId: rowId } = await createSession(sessionId, workspaceId);

    await t.mutation(api.web.directHarness.messages.send, {
      sessionId,
      harnessSessionId: rowId,
      text: 'hello',
    });

    const result = await t.query(api.daemon.directHarness.messages.pendingForMachine, {
      sessionId,
      machineId,
    });

    expect(result.messages.length).toBeGreaterThan(0);
    expect(result.messages.every((m) => typeof m.content === 'string')).toBe(true);
  });

  test('does not return messages before lastProcessedTurnSeq', async () => {
    const { sessionId, machineId, workspaceId } = await setupWorkspaceForSession('pfm-cursor');
    const { sessionId: rowId } = await createSession(sessionId, workspaceId);
    await advancePastInitial(sessionId, rowId);

    const { turnSeq } = await t.mutation(api.web.directHarness.messages.send, {
      sessionId,
      harnessSessionId: rowId,
      text: 'before',
    });

    await t.mutation(api.daemon.directHarness.turns.markTurnProcessed, {
      sessionId,
      harnessSessionId: rowId,
      turnSeq,
    });

    await t.mutation(api.web.directHarness.messages.send, {
      sessionId,
      harnessSessionId: rowId,
      text: 'after',
    });

    const result = await t.query(api.daemon.directHarness.messages.pendingForMachine, {
      sessionId,
      machineId,
    });

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.content).toBe('after');
  });

  test('does not return assistant messages', async () => {
    const { sessionId, machineId, workspaceId } = await setupWorkspaceForSession('pfm-assistant');
    const { sessionId: rowId } = await createSession(sessionId, workspaceId);

    // Write an assistant response
    await t.mutation(api.daemon.directHarness.messages.appendMessages, {
      sessionId,
      harnessSessionId: rowId,
      chunks: [{ content: 'assistant reply', timestamp: 1000 }],
    });

    const result = await t.query(api.daemon.directHarness.messages.pendingForMachine, {
      sessionId,
      machineId,
    });

    // Only the initial user message and assistant reply — but assistant shouldn't appear
    const assistantInResult = result.messages.some((m) => m.content === 'assistant reply');
    expect(assistantInResult).toBe(false);
  });
});

// ─── Message queue ────────────────────────────────────────────────────────────

describe('message queue — routing', () => {
  test('routes to queue when isGenerating is true', async () => {
    const { sessionId, workspaceId } = await setupWorkspaceForSession('queue-generating');
    const { sessionId: rowId } = await createSession(sessionId, workspaceId);
    await advancePastInitial(sessionId, rowId);

    await t.mutation(api.daemon.directHarness.queue.setGenerating, {
      sessionId,
      harnessSessionId: rowId,
      isGenerating: true,
    });

    const result = await t.mutation(api.web.directHarness.messages.send, {
      sessionId,
      harnessSessionId: rowId,
      text: 'while generating',
    });
    expect(result).toEqual({ queued: true });
  });

  test('routes to queue when queue already has items', async () => {
    const { sessionId, workspaceId } = await setupWorkspaceForSession('queue-backlog');
    const { sessionId: rowId } = await createSession(sessionId, workspaceId);
    await advancePastInitial(sessionId, rowId);

    // First send → main table (no work in flight)
    await t.mutation(api.web.directHarness.messages.send, {
      sessionId,
      harnessSessionId: rowId,
      text: 'A',
    });
    // Second send → queue (A is unprocessed)
    await t.mutation(api.web.directHarness.messages.send, {
      sessionId,
      harnessSessionId: rowId,
      text: 'B',
    });
    // Third send → queue (B is queued)
    const r3 = await t.mutation(api.web.directHarness.messages.send, {
      sessionId,
      harnessSessionId: rowId,
      text: 'C',
    });
    expect(r3).toEqual({ queued: true });

    const queue = await t.query(api.web.directHarness.messageQueue.subscribe, {
      sessionId,
      harnessSessionId: rowId,
    });
    expect(queue.map((q) => q.content)).toEqual(['B', 'C']);
  });
});

describe('message queue — dequeueNext', () => {
  test('promotes oldest queued item to main stream (FIFO)', async () => {
    const { sessionId, workspaceId } = await setupWorkspaceForSession('dequeue-fifo');
    const { sessionId: rowId } = await createSession(sessionId, workspaceId);
    await advancePastInitial(sessionId, rowId);

    // A goes to main table; B and C queue because A is unprocessed
    await t.mutation(api.web.directHarness.messages.send, {
      sessionId,
      harnessSessionId: rowId,
      text: 'A',
    });
    await t.mutation(api.web.directHarness.messages.send, {
      sessionId,
      harnessSessionId: rowId,
      text: 'B',
    });
    await t.mutation(api.web.directHarness.messages.send, {
      sessionId,
      harnessSessionId: rowId,
      text: 'C',
    });

    // Simulate daemon: processed A, then started generating
    await t.mutation(api.daemon.directHarness.turns.markTurnProcessed, {
      sessionId,
      harnessSessionId: rowId,
      turnSeq: 2, // A was written as turnSeq=2 (initial message is turnSeq=1)
    });
    await t.mutation(api.daemon.directHarness.queue.setGenerating, {
      sessionId,
      harnessSessionId: rowId,
      isGenerating: true,
    });

    const r1 = await t.mutation(api.daemon.directHarness.queue.dequeueNext, {
      sessionId,
      harnessSessionId: rowId,
    });
    expect(r1?.content).toBe('B');

    const r2 = await t.mutation(api.daemon.directHarness.queue.dequeueNext, {
      sessionId,
      harnessSessionId: rowId,
    });
    expect(r2?.content).toBe('C');

    const r3 = await t.mutation(api.daemon.directHarness.queue.dequeueNext, {
      sessionId,
      harnessSessionId: rowId,
    });
    expect(r3).toBeNull();

    // isGenerating cleared after empty dequeue
    const session = await t.query(api.daemon.directHarness.sessions.getSession, {
      harnessSessionId: rowId,
    });
    expect(session?.isGenerating).toBeFalsy();
  });

  test('dequeued item appears in main stream and disappears from queue', async () => {
    const { sessionId, workspaceId } = await setupWorkspaceForSession('dequeue-promotes');
    const { sessionId: rowId } = await createSession(sessionId, workspaceId);
    await advancePastInitial(sessionId, rowId);

    await t.mutation(api.web.directHarness.messages.send, {
      sessionId,
      harnessSessionId: rowId,
      text: 'first',
    });
    await t.mutation(api.web.directHarness.messages.send, {
      sessionId,
      harnessSessionId: rowId,
      text: 'second',
    });
    // 'first' is in turns (turnSeq=2), 'second' is queued
    await t.mutation(api.daemon.directHarness.turns.markTurnProcessed, {
      sessionId,
      harnessSessionId: rowId,
      turnSeq: 2, // first is turnSeq=2
    });
    await t.mutation(api.daemon.directHarness.queue.setGenerating, {
      sessionId,
      harnessSessionId: rowId,
      isGenerating: true,
    });

    await t.mutation(api.daemon.directHarness.queue.dequeueNext, {
      sessionId,
      harnessSessionId: rowId,
    });

    // Verify dequeued message now appears in the turns table
    const turns = await t.run(async (ctx) =>
      ctx.db
        .query('chatroom_harnessSessionTurns')
        .withIndex('by_session_turnSeq', (q) => q.eq('harnessSessionId', rowId))
        .order('asc')
        .collect()
    );
    const userTurns = turns.filter((t) => t.role === 'user');
    expect(userTurns.map((t) => t.textContent)).toEqual(
      expect.arrayContaining(['first', 'second'])
    );

    const queue = await t.query(api.web.directHarness.messageQueue.subscribe, {
      sessionId,
      harnessSessionId: rowId,
    });
    expect(queue).toHaveLength(0);
  });
});

// ─── Split-subscription queries ───────────────────────────────────────────────

describe('messages.getLatestMessages', () => {
  test('returns up to limit messages newest-first-then-reversed (oldest-to-newest)', async () => {
    const { sessionId, workspaceId } = await setupWorkspaceForSession('glm-basic');
    const { sessionId: rowId } = await createSession(sessionId, workspaceId);

    // Insert 3 assistant chunks using appendMessages
    for (const content of ['A', 'B', 'C']) {
      await t.mutation(api.daemon.directHarness.messages.appendMessages, {
        sessionId,
        harnessSessionId: rowId,
        chunks: [{ content, timestamp: Date.now() }],
      });
    }

    const result = await t.query(api.web.directHarness.messages.getLatestMessages, {
      sessionId,
      harnessSessionId: rowId,
      limit: 2,
    });

    // With limit=2, only the last 2 messages (B, C) are returned
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0]!.content).toBe('B');
    expect(result.messages[1]!.content).toBe('C');
    expect(result.hasMore).toBe(true); // A is older, not included
    expect(typeof result.newestSeq).toBe('number');
    expect(result.newestSeq).toBeGreaterThan(0);
  });

  test('hasMore is false when all messages fit within the limit', async () => {
    const { sessionId, workspaceId } = await setupWorkspaceForSession('glm-fits');
    const { sessionId: rowId } = await createSession(sessionId, workspaceId);

    // No assistant chunks inserted — chunk table is empty
    const result = await t.query(api.web.directHarness.messages.getLatestMessages, {
      sessionId,
      harnessSessionId: rowId,
      limit: 50,
    });

    expect(result.hasMore).toBe(false);
    expect(result.messages).toHaveLength(0);
    expect(result.newestSeq).toBeNull();
  });
});

describe('messages.getMessagesSince', () => {
  test('returns only assistant chunks with seq > afterSeq', async () => {
    const { sessionId, workspaceId } = await setupWorkspaceForSession('gms-basic');
    const { sessionId: rowId } = await createSession(sessionId, workspaceId);

    await t.mutation(api.daemon.directHarness.messages.appendMessages, {
      sessionId,
      harnessSessionId: rowId,
      chunks: [{ content: 'before', timestamp: 1000 }],
    });
    const all = await t.query(api.web.directHarness.messages.subscribe, {
      sessionId,
      harnessSessionId: rowId,
    });
    const afterSeq = all[all.length - 1]!.seq;

    await t.mutation(api.daemon.directHarness.messages.appendMessages, {
      sessionId,
      harnessSessionId: rowId,
      chunks: [{ content: 'after', timestamp: 1001 }],
    });

    const result = await t.query(api.web.directHarness.messages.getMessagesSince, {
      sessionId,
      harnessSessionId: rowId,
      afterSeq,
    });

    expect(result).toHaveLength(1);
    expect(result[0]!.content).toBe('after');
    expect(result[0]!.seq).toBeGreaterThan(afterSeq);
  });

  test('returns empty array when no messages exist after afterSeq', async () => {
    const { sessionId, workspaceId } = await setupWorkspaceForSession('gms-empty');
    const { sessionId: rowId } = await createSession(sessionId, workspaceId);

    const result = await t.query(api.web.directHarness.messages.getMessagesSince, {
      sessionId,
      harnessSessionId: rowId,
      afterSeq: 9999,
    });
    expect(result).toHaveLength(0);
  });
});

describe('messages.getOlderMessages', () => {
  test('returns assistant chunks with seq < beforeSeq, oldest-to-newest, up to limit', async () => {
    const { sessionId, workspaceId } = await setupWorkspaceForSession('gom-basic');
    const { sessionId: rowId } = await createSession(sessionId, workspaceId);

    // Insert A, B, C assistant chunks
    for (const content of ['A', 'B', 'C']) {
      await t.mutation(api.daemon.directHarness.messages.appendMessages, {
        sessionId,
        harnessSessionId: rowId,
        chunks: [{ content, timestamp: Date.now() }],
      });
    }

    // Get the seq of C (the latest)
    const { newestSeq: seqC } = await t.query(api.web.directHarness.messages.getLatestMessages, {
      sessionId,
      harnessSessionId: rowId,
      limit: 1,
    });

    const result = await t.query(api.web.directHarness.messages.getOlderMessages, {
      sessionId,
      harnessSessionId: rowId,
      beforeSeq: seqC,
      limit: 2,
    });

    // Should return the 2 messages before C
    expect(result.messages).toHaveLength(2);
    // They should be in ascending seq order
    expect(result.messages[0]!.seq).toBeLessThan(result.messages[1]!.seq);
    // All returned seqs must be less than seqC
    for (const m of result.messages) {
      expect(m.seq).toBeLessThan(seqC);
    }
  });

  test('hasMore is false when all older messages fit in limit', async () => {
    const { sessionId, workspaceId } = await setupWorkspaceForSession('gom-fits');
    const { sessionId: rowId } = await createSession(sessionId, workspaceId);

    const { newestSeq } = await t.query(api.web.directHarness.messages.getLatestMessages, {
      sessionId,
      harnessSessionId: rowId,
      limit: 50,
    });

    const result = await t.query(api.web.directHarness.messages.getOlderMessages, {
      sessionId,
      harnessSessionId: rowId,
      beforeSeq: newestSeq + 1,
      limit: 50,
    });

    expect(result.hasMore).toBe(false);
  });
});
