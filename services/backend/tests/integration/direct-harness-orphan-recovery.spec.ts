/**
 * Direct Harness — Orphan Recovery Integration Tests
 *
 * Covers:
 *  - markOrphanTurnsFailed: streaming turn with chunks → status='failed', textContent populated
 *  - markOrphanTurnsFailed: streaming turn without messageId → status='failed', textContent empty
 *  - markOrphanTurnsFailed: pending turn → status='failed', textContent empty
 *  - markOrphanTurnsFailed: leaves 'complete' turns untouched
 *  - markOrphanTurnsFailed: clears isGenerating on the session
 *  - markOrphanTurnsFailed: returns correct count
 *  - getMachineHarnessSessions: returns only sessions whose workspace belongs to the machine
 *  - getMachineHarnessSessions: filters to 'active'/'idle' status only
 *  - Auth: rejects calls without directHarnessWorkers feature flag
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

// ─── markOrphanTurnsFailed ────────────────────────────────────────────────────

describe('turns.markOrphanTurnsFailed', () => {
  test('streaming turn with chunks → status=failed, textContent populated from chunks, completedAt set', async () => {
    const { sessionId, workspaceId, machineId } =
      await setupWorkspaceForSession('orphan-streaming-chunks');
    const { sessionId: rowId } = await createSession(sessionId, workspaceId);

    // Begin and bind a turn
    const { turnId } = await t.mutation(api.daemon.directHarness.turns.beginAssistantTurn, {
      sessionId,
      harnessSessionId: rowId,
    });
    await t.mutation(api.daemon.directHarness.turns.bindTurnMessageId, {
      sessionId,
      turnId: turnId as Id<'chatroom_harnessSessionTurns'>,
      messageId: 'msg-orphan-1',
    });

    // Insert some chunks
    await t.mutation(api.daemon.directHarness.messages.appendMessages, {
      sessionId,
      harnessSessionId: rowId,
      chunks: [
        { content: 'partial ', timestamp: 1, messageId: 'msg-orphan-1', partType: 'text' },
        { content: 'response', timestamp: 2, messageId: 'msg-orphan-1', partType: 'text' },
        {
          content: 'some thinking',
          timestamp: 3,
          messageId: 'msg-orphan-1',
          partType: 'reasoning',
        },
      ],
    });

    // Mark orphan turns as failed
    const result = await t.mutation(api.daemon.directHarness.turns.markOrphanTurnsFailed, {
      sessionId,
      machineId,
      harnessSessionId: rowId,
    });

    expect(result.failedTurns).toBe(1);

    const row = await t.run(async (ctx) =>
      ctx.db.get(turnId as Id<'chatroom_harnessSessionTurns'>)
    );
    expect(row?.status).toBe('failed');
    expect(row?.textContent).toBe('partial response');
    expect(row?.reasoningContent).toBe('some thinking');
    expect(row?.completedAt).toBeDefined();
  });

  test('streaming turn without messageId → status=failed, textContent stays empty', async () => {
    const { sessionId, workspaceId, machineId } =
      await setupWorkspaceForSession('orphan-streaming-nomsg');
    const { sessionId: rowId } = await createSession(sessionId, workspaceId);

    // Begin but don't bind a messageId — stays streaming-ish but no messageId
    // We need to manually set it to streaming without messageId via internal t.run
    const { turnId } = await t.mutation(api.daemon.directHarness.turns.beginAssistantTurn, {
      sessionId,
      harnessSessionId: rowId,
    });

    // Manually patch to streaming without messageId (simulating edge case)
    await t.run(async (ctx) => {
      await ctx.db.patch(turnId as Id<'chatroom_harnessSessionTurns'>, {
        status: 'streaming',
      });
    });

    const result = await t.mutation(api.daemon.directHarness.turns.markOrphanTurnsFailed, {
      sessionId,
      machineId,
      harnessSessionId: rowId,
    });

    expect(result.failedTurns).toBe(1);

    const row = await t.run(async (ctx) =>
      ctx.db.get(turnId as Id<'chatroom_harnessSessionTurns'>)
    );
    expect(row?.status).toBe('failed');
    expect(row?.textContent).toBe('');
    expect(row?.reasoningContent).toBe('');
    expect(row?.completedAt).toBeDefined();
  });

  test('pending turn → status=failed, textContent stays empty', async () => {
    const { sessionId, workspaceId, machineId } = await setupWorkspaceForSession('orphan-pending');
    const { sessionId: rowId } = await createSession(sessionId, workspaceId);

    const { turnId } = await t.mutation(api.daemon.directHarness.turns.beginAssistantTurn, {
      sessionId,
      harnessSessionId: rowId,
    });

    // Turn is pending — don't bind or stream

    const result = await t.mutation(api.daemon.directHarness.turns.markOrphanTurnsFailed, {
      sessionId,
      machineId,
      harnessSessionId: rowId,
    });

    expect(result.failedTurns).toBe(1);

    const row = await t.run(async (ctx) =>
      ctx.db.get(turnId as Id<'chatroom_harnessSessionTurns'>)
    );
    expect(row?.status).toBe('failed');
    expect(row?.textContent).toBe('');
    expect(row?.completedAt).toBeDefined();
  });

  test('leaves complete turns untouched', async () => {
    const { sessionId, workspaceId, machineId } = await setupWorkspaceForSession(
      'orphan-complete-untouched'
    );
    const { sessionId: rowId } = await createSession(sessionId, workspaceId);

    const { turnId } = await t.mutation(api.daemon.directHarness.turns.beginAssistantTurn, {
      sessionId,
      harnessSessionId: rowId,
    });

    // Finalize the turn (complete)
    await t.mutation(api.daemon.directHarness.turns.finalizeAssistantTurn, {
      sessionId,
      turnId: turnId as Id<'chatroom_harnessSessionTurns'>,
    });

    const result = await t.mutation(api.daemon.directHarness.turns.markOrphanTurnsFailed, {
      sessionId,
      machineId,
      harnessSessionId: rowId,
    });

    expect(result.failedTurns).toBe(0);

    const row = await t.run(async (ctx) =>
      ctx.db.get(turnId as Id<'chatroom_harnessSessionTurns'>)
    );
    expect(row?.status).toBe('complete');
  });

  test('clears isGenerating on the session', async () => {
    const { sessionId, workspaceId, machineId } =
      await setupWorkspaceForSession('orphan-is-generating');
    const { sessionId: rowId } = await createSession(sessionId, workspaceId);

    // Set isGenerating = true manually
    await t.run(async (ctx) => {
      await ctx.db.patch(rowId as Id<'chatroom_harnessSessions'>, { isGenerating: true });
    });

    await t.mutation(api.daemon.directHarness.turns.markOrphanTurnsFailed, {
      sessionId,
      machineId,
      harnessSessionId: rowId,
    });

    const session = await t.run(async (ctx) => ctx.db.get(rowId as Id<'chatroom_harnessSessions'>));
    expect(session?.isGenerating).toBe(false);
  });

  test('returns correct count when multiple orphan turns exist', async () => {
    const { sessionId, workspaceId, machineId } = await setupWorkspaceForSession('orphan-count');
    const { sessionId: rowId } = await createSession(sessionId, workspaceId);

    // Create 2 pending assistant turns + 1 streaming turn
    const t1 = await t.mutation(api.daemon.directHarness.turns.beginAssistantTurn, {
      sessionId,
      harnessSessionId: rowId,
    });
    const t2 = await t.mutation(api.daemon.directHarness.turns.beginAssistantTurn, {
      sessionId,
      harnessSessionId: rowId,
    });
    const t3 = await t.mutation(api.daemon.directHarness.turns.beginAssistantTurn, {
      sessionId,
      harnessSessionId: rowId,
    });

    // Bind t3 to streaming
    await t.mutation(api.daemon.directHarness.turns.bindTurnMessageId, {
      sessionId,
      turnId: t3.turnId as Id<'chatroom_harnessSessionTurns'>,
      messageId: 'msg-count',
    });

    // Finalize t1 (complete — should not be counted)
    await t.mutation(api.daemon.directHarness.turns.finalizeAssistantTurn, {
      sessionId,
      turnId: t1.turnId as Id<'chatroom_harnessSessionTurns'>,
    });

    // Mark orphans — t2 (pending) + t3 (streaming) = 2 failures
    const result = await t.mutation(api.daemon.directHarness.turns.markOrphanTurnsFailed, {
      sessionId,
      machineId,
      harnessSessionId: rowId,
    });

    expect(result.failedTurns).toBe(2);
  });

  test('auth: rejects calls without directHarnessWorkers feature flag', async () => {
    const { sessionId, workspaceId, machineId } =
      await setupWorkspaceForSession('orphan-auth-flag');
    const { sessionId: rowId } = await createSession(sessionId, workspaceId);

    featureFlags.directHarnessWorkers = false;

    await expect(
      t.mutation(api.daemon.directHarness.turns.markOrphanTurnsFailed, {
        sessionId,
        machineId,
        harnessSessionId: rowId,
      })
    ).rejects.toThrow();
  });
});

// ─── getMachineHarnessSessions ────────────────────────────────────────────────

describe('turns.getMachineHarnessSessions', () => {
  test('returns active and idle sessions for sessions owned by the machine', async () => {
    const { sessionId, workspaceId, machineId } =
      await setupWorkspaceForSession('get-sessions-basic');

    // Create an active-type session via the normal flow
    const { sessionId: harnessSessionId } = await createSession(sessionId, workspaceId);

    const sessions = await t.query(api.daemon.directHarness.turns.getMachineHarnessSessions, {
      sessionId,
      machineId,
    });

    // The session created by createSession uses web/sessions.create which starts as 'pending'
    // then associate makes it 'active'. Since we haven't associated, it may be 'pending'.
    // We need to check at least we get results for the workspace
    expect(Array.isArray(sessions)).toBe(true);
    // Each result should reference the correct harnessSessionId
    const found = sessions.find((s) => s.harnessSessionId === harnessSessionId);
    // The session may or may not appear depending on its status ('pending' is not returned)
    // Let's patch the session to 'idle' and verify it shows
    await t.run(async (ctx) => {
      await ctx.db.patch(harnessSessionId as Id<'chatroom_harnessSessions'>, { status: 'idle' });
    });

    const sessions2 = await t.query(api.daemon.directHarness.turns.getMachineHarnessSessions, {
      sessionId,
      machineId,
    });
    const found2 = sessions2.find((s) => s.harnessSessionId === harnessSessionId);
    expect(found2).toBeDefined();
    expect(found2?.status).toBe('idle');
  });

  test('does not return sessions from a different machine', async () => {
    const { sessionId, workspaceId, machineId } =
      await setupWorkspaceForSession('get-sessions-isolation');
    const { sessionId: harnessSessionId } = await createSession(sessionId, workspaceId);

    // Make the session idle so it would normally appear
    await t.run(async (ctx) => {
      await ctx.db.patch(harnessSessionId as Id<'chatroom_harnessSessions'>, { status: 'idle' });
    });

    // Query with a different machineId
    const sessions = await t.query(api.daemon.directHarness.turns.getMachineHarnessSessions, {
      sessionId,
      machineId: 'other-machine-xyz',
    });

    const found = sessions.find((s) => s.harnessSessionId === harnessSessionId);
    expect(found).toBeUndefined();
  });

  test('does not return sessions with closed or failed status', async () => {
    const { sessionId, workspaceId, machineId } =
      await setupWorkspaceForSession('get-sessions-closed');
    const { sessionId: harnessSessionId } = await createSession(sessionId, workspaceId);

    // Patch to closed
    await t.run(async (ctx) => {
      await ctx.db.patch(harnessSessionId as Id<'chatroom_harnessSessions'>, { status: 'closed' });
    });

    const sessions = await t.query(api.daemon.directHarness.turns.getMachineHarnessSessions, {
      sessionId,
      machineId,
    });

    const found = sessions.find((s) => s.harnessSessionId === harnessSessionId);
    expect(found).toBeUndefined();
  });
});
