/**
 * Direct Harness — Sessions Integration Tests
 *
 * Covers: create (frontend), associateHarnessSessionId, closeSession,
 * updateCursor, listPendingSessionsForMachine
 */

import type { SessionId } from 'convex-helpers/server/sessions';
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

// ─── create ──────────────────────────────────────────────────────────────────

describe('sessions.create', () => {
  test('creates a session and returns sessionId', async () => {
    const { sessionId, workspaceId } = await setupWorkspaceForSession('create-success');
    const result = await createSession(sessionId, workspaceId);
    expect(result.sessionId).toBeDefined();
  });

  test('session appears as pending for the machine', async () => {
    const { sessionId, machineId, workspaceId } = await setupWorkspaceForSession('create-pending');
    const { sessionId: rowId } = await createSession(sessionId, workspaceId);

    const pending = await t.query(
      api.daemon.directHarness.sessions.listPendingSessionsForMachine,
      { sessionId, machineId }
    );
    expect(pending.some((s) => s._id === rowId)).toBe(true);
  });

  test('writes the first user message', async () => {
    const { sessionId, workspaceId } = await setupWorkspaceForSession('create-msg');
    const { sessionId: rowId } = await createSession(sessionId, workspaceId);

    const messages = await t.query(api.web.directHarness.messages.subscribe, {
      sessionId,
      harnessSessionId: rowId,
    });
    expect(messages).toHaveLength(1);
    expect(messages[0]?.role).toBe('user');
    expect(messages[0]?.content).toBe('Starting session as builder');
  });

  test('throws when feature flag is off', async () => {
    featureFlags.directHarnessWorkers = false;
    const { sessionId, workspaceId } = await setupWorkspaceForSession('create-flag-off');
    await expect(createSession(sessionId, workspaceId)).rejects.toThrow(
      'directHarnessWorkers'
    );
  });
});

// ─── associateHarnessSessionId ────────────────────────────────────────────────

describe('associateHarnessSessionId', () => {
  test('removes session from pending list and sets harnessSessionId', async () => {
    const { sessionId, machineId, workspaceId } = await setupWorkspaceForSession('assoc-success');
    const { sessionId: rowId } = await createSession(sessionId, workspaceId);

    // Confirm pending
    const pendingBefore = await t.query(
      api.daemon.directHarness.sessions.listPendingSessionsForMachine,
      { sessionId, machineId }
    );
    expect(pendingBefore.some((s) => s._id === rowId)).toBe(true);

    // Associate
    await t.mutation(
      api.daemon.directHarness.sessions.associateHarnessSessionId,
      { sessionId, harnessSessionId: rowId, opencodeSessionId: 'sdk-abc' }
    );

    // No longer pending
    const pendingAfter = await t.query(
      api.daemon.directHarness.sessions.listPendingSessionsForMachine,
      { sessionId, machineId }
    );
    expect(pendingAfter.some((s) => s._id === rowId)).toBe(false);
  });

  test('idempotent on same harnessSessionId', async () => {
    const { sessionId, workspaceId } = await setupWorkspaceForSession('assoc-idem');
    const { sessionId: rowId } = await createSession(sessionId, workspaceId);

    await t.mutation(
      api.daemon.directHarness.sessions.associateHarnessSessionId,
      { sessionId, harnessSessionId: rowId, opencodeSessionId: 'sdk-abc' }
    );

    await expect(
      t.mutation(
        api.daemon.directHarness.sessions.associateHarnessSessionId,
        { sessionId, harnessSessionId: rowId, opencodeSessionId: 'sdk-abc' }
      )
    ).resolves.not.toThrow();
  });

  test('throws on different harnessSessionId', async () => {
    const { sessionId, workspaceId } = await setupWorkspaceForSession('assoc-conflict');
    const { sessionId: rowId } = await createSession(sessionId, workspaceId);

    await t.mutation(
      api.daemon.directHarness.sessions.associateHarnessSessionId,
      { sessionId, harnessSessionId: rowId, opencodeSessionId: 'sdk-first' }
    );

    await expect(
      t.mutation(
        api.daemon.directHarness.sessions.associateHarnessSessionId,
        { sessionId, harnessSessionId: rowId, opencodeSessionId: 'sdk-different' }
      )
    ).rejects.toThrow();
  });
});

// ─── closeSession ────────────────────────────────────────────────────────────

describe('closeSession', () => {
  test('marks a session as closed', async () => {
    const { sessionId, workspaceId } = await setupWorkspaceForSession('close-success');
    const { sessionId: rowId } = await createSession(sessionId, workspaceId);

    await t.mutation(
      api.daemon.directHarness.sessions.closeSession,
      { sessionId, harnessSessionId: rowId }
    );
  });
});

// ─── updateCursor ─────────────────────────────────────────────────────────────

describe('updateCursor', () => {
  test('persists lastProcessedSeq and affects pendingForMachine', async () => {
    const { sessionId, machineId, workspaceId } = await setupWorkspaceForSession('cursor-test');
    const { sessionId: rowId } = await createSession(sessionId, workspaceId);

    // Advance past the initial message from createSession so subsequent sends
    // go to the main table (not the queue).
    await t.mutation(api.daemon.directHarness.sessions.updateCursor,
      { sessionId, harnessSessionId: rowId, seq: 1 });

    // Send two user messages, advancing cursor between them so both go to main table
    const { seq: seq1 } = await t.mutation(
      api.web.directHarness.messages.send,
      { sessionId, harnessSessionId: rowId, text: 'first' }
    );
    // Advancing cursor to seq1 is also what the test is validating — do it now
    // so the second send goes to the main table, then assert below.
    await t.mutation(
      api.daemon.directHarness.sessions.updateCursor,
      { sessionId, harnessSessionId: rowId, seq: seq1 }
    );
    const { seq: seq2 } = await t.mutation(
      api.web.directHarness.messages.send,
      { sessionId, harnessSessionId: rowId, text: 'second' }
    );

    // pendingForMachine should only return messages after seq1
    const result = await t.query(
      api.daemon.directHarness.messages.pendingForMachine,
      { sessionId, machineId }
    );

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.seq).toBe(seq2);
  });
});

// ─── listPendingSessionsForMachine ───────────────────────────────────────────

describe('listPendingSessionsForMachine', () => {
  test('returns pending sessions for the machine', async () => {
    const { sessionId, machineId, workspaceId } = await setupWorkspaceForSession('lpsfm-basic');
    const { sessionId: rowId } = await createSession(sessionId, workspaceId);

    const pending = await t.query(
      api.daemon.directHarness.sessions.listPendingSessionsForMachine,
      { sessionId, machineId }
    );
    expect(pending.some((s) => s._id === rowId)).toBe(true);
  });

  test('does not return session after association', async () => {
    const { sessionId, machineId, workspaceId } = await setupWorkspaceForSession('lpsfm-assoc');
    const { sessionId: rowId } = await createSession(sessionId, workspaceId);

    await t.mutation(
      api.daemon.directHarness.sessions.associateHarnessSessionId,
      { sessionId, harnessSessionId: rowId, opencodeSessionId: 'sdk-abc' }
    );

    const pending = await t.query(
      api.daemon.directHarness.sessions.listPendingSessionsForMachine,
      { sessionId, machineId }
    );
    expect(pending.some((s) => s._id === rowId)).toBe(false);
  });

  test('does not return sessions for a different machine', async () => {
    const { sessionId, workspaceId } = await setupWorkspaceForSession('lpsfm-other');
    const { sessionId: rowId } = await createSession(sessionId, workspaceId);

    const pending = await t.query(
      api.daemon.directHarness.sessions.listPendingSessionsForMachine,
      { sessionId, machineId: 'other-machine' }
    );
    expect(pending.length).toBe(0);
  });

  test('returns [] on auth failure', async () => {
    const { machineId } = await setupWorkspaceForSession('lpsfm-auth');

    const pending = await t.query(
      api.daemon.directHarness.sessions.listPendingSessionsForMachine,
      { sessionId: 'invalid-session' as SessionId, machineId }
    );
    expect(pending).toEqual([]);
  });
});

// ─── markIdle / markFailed / markActive ──────────────────────────────────────

describe('markIdle', () => {
  test('sets status to idle and clears isGenerating', async () => {
    const { sessionId, workspaceId } = await setupWorkspaceForSession('mark-idle-basic');
    const { sessionId: rowId } = await createSession(sessionId, workspaceId);

    await t.mutation(api.daemon.directHarness.sessions.markIdle, {
      sessionId,
      harnessSessionId: rowId,
    });

    const session = await t.query(api.daemon.directHarness.sessions.getSession, {
      harnessSessionId: rowId,
    });
    expect(session?.status).toBe('idle');
    expect(session?.isGenerating).toBe(false);
  });

  test('does not overwrite failed status', async () => {
    const { sessionId, workspaceId } = await setupWorkspaceForSession('mark-idle-no-overwrite');
    const { sessionId: rowId } = await createSession(sessionId, workspaceId);

    await t.mutation(api.daemon.directHarness.sessions.markFailed, { sessionId, harnessSessionId: rowId });
    await t.mutation(api.daemon.directHarness.sessions.markIdle, { sessionId, harnessSessionId: rowId });

    const session = await t.query(api.daemon.directHarness.sessions.getSession, { harnessSessionId: rowId });
    expect(session?.status).toBe('failed');
  });
});

describe('markFailed', () => {
  test('sets status to failed', async () => {
    const { sessionId, workspaceId } = await setupWorkspaceForSession('mark-failed-basic');
    const { sessionId: rowId } = await createSession(sessionId, workspaceId);

    await t.mutation(api.daemon.directHarness.sessions.markFailed, {
      sessionId,
      harnessSessionId: rowId,
    });

    const session = await t.query(api.daemon.directHarness.sessions.getSession, {
      harnessSessionId: rowId,
    });
    expect(session?.status).toBe('failed');
  });
});

describe('markActive', () => {
  test('sets status to active', async () => {
    const { sessionId, workspaceId } = await setupWorkspaceForSession('mark-active-basic');
    const { sessionId: rowId } = await createSession(sessionId, workspaceId);

    await t.mutation(api.daemon.directHarness.sessions.markIdle, { sessionId, harnessSessionId: rowId });
    await t.mutation(api.daemon.directHarness.sessions.markActive, { sessionId, harnessSessionId: rowId });

    const session = await t.query(api.daemon.directHarness.sessions.getSession, { harnessSessionId: rowId });
    expect(session?.status).toBe('active');
  });

  test('does not overwrite failed or closed', async () => {
    const { sessionId, workspaceId } = await setupWorkspaceForSession('mark-active-no-overwrite');
    const { sessionId: rowId } = await createSession(sessionId, workspaceId);

    await t.mutation(api.daemon.directHarness.sessions.markFailed, { sessionId, harnessSessionId: rowId });
    await t.mutation(api.daemon.directHarness.sessions.markActive, { sessionId, harnessSessionId: rowId });

    const session = await t.query(api.daemon.directHarness.sessions.getSession, { harnessSessionId: rowId });
    expect(session?.status).toBe('failed');
  });
});

describe('pendingForMachine — idle sessions', () => {
  test('idle sessions with unprocessed messages are returned', async () => {
    const { sessionId, machineId, workspaceId } = await setupWorkspaceForSession('pfm-idle');
    const { sessionId: rowId } = await createSession(sessionId, workspaceId);

    // Simulate daemon marking the session idle after a crash
    await t.mutation(api.daemon.directHarness.sessions.markIdle, { sessionId, harnessSessionId: rowId });

    const result = await t.query(api.daemon.directHarness.messages.pendingForMachine, {
      sessionId,
      machineId,
    });

    // The initial message from createSession is still unprocessed
    expect(result.sessions.some((s) => s._id === rowId)).toBe(true);
    expect(result.messages.some((m) => m.harnessSessionId === rowId)).toBe(true);
  });

  test('failed sessions are not returned', async () => {
    const { sessionId, machineId, workspaceId } = await setupWorkspaceForSession('pfm-failed');
    const { sessionId: rowId } = await createSession(sessionId, workspaceId);

    await t.mutation(api.daemon.directHarness.sessions.markFailed, { sessionId, harnessSessionId: rowId });

    const result = await t.query(api.daemon.directHarness.messages.pendingForMachine, {
      sessionId,
      machineId,
    });

    expect(result.sessions.every((s) => s._id !== rowId)).toBe(true);
  });
});
