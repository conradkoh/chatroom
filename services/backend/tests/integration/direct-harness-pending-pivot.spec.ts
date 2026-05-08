/**
 * Direct Harness — Pending Pivot Integration Tests (Step 3)
 *
 * Verifies that user messages are written to chatroom_harnessSessionTurns
 * (not chatroom_harnessSessionMessages) after the step-3 pivot, and that
 * pendingForMachine reads from the turn table.
 */

import { describe, expect, test, beforeEach, afterEach } from 'vitest';

import { featureFlags } from '../../config/featureFlags';
import { api } from '../../convex/_generated/api';
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

// ─── web.sessions.create writes a user turn ──────────────────────────────────

describe('web.sessions.create — user turn', () => {
  test('firstMessage is written as a user turn row (not a chunk row)', async () => {
    const { sessionId, workspaceId } = await setupWorkspaceForSession('pp-create');
    const { sessionId: rowId } = await createSession(sessionId, workspaceId);

    // Should have a user turn
    const turns = await t.run(async (ctx) =>
      ctx.db
        .query('chatroom_harnessSessionTurns')
        .withIndex('by_session_turnSeq', (q) => q.eq('harnessSessionId', rowId))
        .collect()
    );
    const userTurns = turns.filter((t) => t.role === 'user');
    expect(userTurns).toHaveLength(1);
    expect(userTurns[0]!.status).toBe('complete');
    expect(userTurns[0]!.textContent).toContain('Starting session');

    // Should have ZERO user rows in the chunk table
    const chunkUserRows = await t.run(async (ctx) =>
      ctx.db
        .query('chatroom_harnessSessionMessages')
        .withIndex('by_session_role_seq', (q) => q.eq('harnessSessionId', rowId).eq('role', 'user'))
        .collect()
    );
    expect(chunkUserRows).toHaveLength(0);
  });
});

// ─── web.messages.send direct path writes a user turn ────────────────────────

describe('web.messages.send — direct path (no queue)', () => {
  test('writes a user turn and returns turnSeq', async () => {
    const { sessionId, workspaceId } = await setupWorkspaceForSession('pp-send');
    const { sessionId: rowId } = await createSession(sessionId, workspaceId);

    // Advance past the initial turn so next send goes direct
    await t.mutation(api.daemon.directHarness.turns.markTurnProcessed, {
      sessionId,
      harnessSessionId: rowId,
      turnSeq: 1,
    });

    const result = await t.mutation(api.web.directHarness.messages.send, {
      sessionId,
      harnessSessionId: rowId,
      text: 'direct message',
    });

    expect(result).toHaveProperty('turnSeq');
    expect((result as { turnSeq: number }).turnSeq).toBeGreaterThan(0);

    // Turn exists in turn table
    const turns = await t.run(async (ctx) =>
      ctx.db
        .query('chatroom_harnessSessionTurns')
        .withIndex('by_session_turnSeq', (q) => q.eq('harnessSessionId', rowId))
        .collect()
    );
    const userTurns = turns.filter((t) => t.role === 'user');
    expect(userTurns.some((t) => t.textContent === 'direct message')).toBe(true);

    // No user rows in chunk table
    const chunkUserRows = await t.run(async (ctx) =>
      ctx.db
        .query('chatroom_harnessSessionMessages')
        .withIndex('by_session_role_seq', (q) => q.eq('harnessSessionId', rowId).eq('role', 'user'))
        .collect()
    );
    expect(chunkUserRows).toHaveLength(0);
  });
});

// ─── daemon.queue.dequeueNext promotes to turn row ───────────────────────────

describe('daemon.queue.dequeueNext — promotes to turn row', () => {
  test('queued item becomes a turn row (not a chunk row)', async () => {
    const { sessionId, workspaceId } = await setupWorkspaceForSession('pp-dequeue');
    const { sessionId: rowId } = await createSession(sessionId, workspaceId);

    // Advance past initial, then send 'A' (direct) and 'B' (queued)
    await t.mutation(api.daemon.directHarness.turns.markTurnProcessed, {
      sessionId,
      harnessSessionId: rowId,
      turnSeq: 1,
    });
    await t.mutation(api.web.directHarness.messages.send, {
      sessionId,
      harnessSessionId: rowId,
      text: 'A',
    });
    // 'B' goes to queue because 'A' is unprocessed
    await t.mutation(api.web.directHarness.messages.send, {
      sessionId,
      harnessSessionId: rowId,
      text: 'B',
    });

    // Simulate daemon advancing past 'A' then dequeuing 'B'
    await t.mutation(api.daemon.directHarness.turns.markTurnProcessed, {
      sessionId,
      harnessSessionId: rowId,
      turnSeq: 2,
    });
    await t.mutation(api.daemon.directHarness.queue.setGenerating, {
      sessionId,
      harnessSessionId: rowId,
      isGenerating: true,
    });

    const dequeued = await t.mutation(api.daemon.directHarness.queue.dequeueNext, {
      sessionId,
      harnessSessionId: rowId,
    });
    expect(dequeued?.content).toBe('B');

    // 'B' should now be in the turn table
    const turns = await t.run(async (ctx) =>
      ctx.db
        .query('chatroom_harnessSessionTurns')
        .withIndex('by_session_turnSeq', (q) => q.eq('harnessSessionId', rowId))
        .collect()
    );
    const userTurns = turns.filter((t) => t.role === 'user');
    expect(userTurns.some((t) => t.textContent === 'B')).toBe(true);

    // 'B' should NOT be in the chunk table
    const chunkUserRows = await t.run(async (ctx) =>
      ctx.db
        .query('chatroom_harnessSessionMessages')
        .withIndex('by_session_role_seq', (q) => q.eq('harnessSessionId', rowId).eq('role', 'user'))
        .collect()
    );
    expect(chunkUserRows).toHaveLength(0);
  });
});

// ─── pendingForMachine reads from turn table ──────────────────────────────────

describe('pendingForMachine — reads turns', () => {
  test('returns user turn content and turnSeq as wire seq', async () => {
    const { sessionId, machineId, workspaceId } = await setupWorkspaceForSession('pp-pending');
    const { sessionId: rowId } = await createSession(sessionId, workspaceId);

    const result = await t.query(api.daemon.directHarness.messages.pendingForMachine, {
      sessionId,
      machineId,
    });

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]!.content).toContain('Starting session');
    expect(result.messages[0]!.seq).toBe(1); // turnSeq=1 mapped as seq in wire shape
  });

  test('after markTurnProcessed, pendingForMachine no longer returns the consumed turn', async () => {
    const { sessionId, machineId, workspaceId } = await setupWorkspaceForSession('pp-consumed');
    const { sessionId: rowId } = await createSession(sessionId, workspaceId);

    // Verify it appears before ack
    const before = await t.query(api.daemon.directHarness.messages.pendingForMachine, {
      sessionId,
      machineId,
    });
    expect(before.messages).toHaveLength(1);

    // Ack it
    await t.mutation(api.daemon.directHarness.turns.markTurnProcessed, {
      sessionId,
      harnessSessionId: rowId,
      turnSeq: 1,
    });

    // Should no longer appear
    const after = await t.query(api.daemon.directHarness.messages.pendingForMachine, {
      sessionId,
      machineId,
    });
    expect(after.messages).toHaveLength(0);
  });

  test('cursor (lastProcessedSeq in wire shape) equals session lastProcessedTurnSeq', async () => {
    const { sessionId, machineId, workspaceId } = await setupWorkspaceForSession('pp-cursor');
    const { sessionId: rowId } = await createSession(sessionId, workspaceId);

    const result = await t.query(api.daemon.directHarness.messages.pendingForMachine, {
      sessionId,
      machineId,
    });

    expect(result.sessions).toHaveLength(1);
    // lastProcessedTurnSeq defaults to 0, so wire lastProcessedSeq = 0
    expect(result.sessions[0]!.lastProcessedSeq).toBe(0);
  });
});
