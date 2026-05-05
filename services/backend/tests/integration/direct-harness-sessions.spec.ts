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
      api.chatroom.directHarness.sessions.listPendingSessionsForMachine,
      { sessionId, machineId }
    );
    expect(pending.some((s) => s._id === rowId)).toBe(true);
  });

  test('writes the first user message', async () => {
    const { sessionId, workspaceId } = await setupWorkspaceForSession('create-msg');
    const { sessionId: rowId } = await createSession(sessionId, workspaceId);

    const messages = await t.query(api.chatroom.directHarness.messages.subscribe, {
      sessionId,
      harnessSessionRowId: rowId,
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
      api.chatroom.directHarness.sessions.listPendingSessionsForMachine,
      { sessionId, machineId }
    );
    expect(pendingBefore.some((s) => s._id === rowId)).toBe(true);

    // Associate
    await t.mutation(
      api.chatroom.directHarness.sessions.associateHarnessSessionId,
      { sessionId, harnessSessionRowId: rowId, harnessSessionId: 'sdk-abc' }
    );

    // No longer pending
    const pendingAfter = await t.query(
      api.chatroom.directHarness.sessions.listPendingSessionsForMachine,
      { sessionId, machineId }
    );
    expect(pendingAfter.some((s) => s._id === rowId)).toBe(false);
  });

  test('idempotent on same harnessSessionId', async () => {
    const { sessionId, workspaceId } = await setupWorkspaceForSession('assoc-idem');
    const { sessionId: rowId } = await createSession(sessionId, workspaceId);

    await t.mutation(
      api.chatroom.directHarness.sessions.associateHarnessSessionId,
      { sessionId, harnessSessionRowId: rowId, harnessSessionId: 'sdk-abc' }
    );

    await expect(
      t.mutation(
        api.chatroom.directHarness.sessions.associateHarnessSessionId,
        { sessionId, harnessSessionRowId: rowId, harnessSessionId: 'sdk-abc' }
      )
    ).resolves.not.toThrow();
  });

  test('throws on different harnessSessionId', async () => {
    const { sessionId, workspaceId } = await setupWorkspaceForSession('assoc-conflict');
    const { sessionId: rowId } = await createSession(sessionId, workspaceId);

    await t.mutation(
      api.chatroom.directHarness.sessions.associateHarnessSessionId,
      { sessionId, harnessSessionRowId: rowId, harnessSessionId: 'sdk-first' }
    );

    await expect(
      t.mutation(
        api.chatroom.directHarness.sessions.associateHarnessSessionId,
        { sessionId, harnessSessionRowId: rowId, harnessSessionId: 'sdk-different' }
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
      api.chatroom.directHarness.sessions.closeSession,
      { sessionId, harnessSessionRowId: rowId }
    );
  });
});

// ─── updateCursor ─────────────────────────────────────────────────────────────

describe('updateCursor', () => {
  test('persists lastProcessedSeq and affects pendingForMachine', async () => {
    const { sessionId, machineId, workspaceId } = await setupWorkspaceForSession('cursor-test');
    const { sessionId: rowId } = await createSession(sessionId, workspaceId);

    // Send two user messages
    const { seq: seq1 } = await t.mutation(
      api.chatroom.directHarness.messages.send,
      { sessionId, harnessSessionRowId: rowId, text: 'first' }
    );
    const { seq: seq2 } = await t.mutation(
      api.chatroom.directHarness.messages.send,
      { sessionId, harnessSessionRowId: rowId, text: 'second' }
    );

    // Update cursor past first message
    await t.mutation(
      api.chatroom.directHarness.sessions.updateCursor,
      { sessionId, harnessSessionRowId: rowId, seq: seq1 }
    );

    // pendingForMachine should only return messages after seq1
    const result = await t.query(
      api.chatroom.directHarness.messages.pendingForMachine,
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
      api.chatroom.directHarness.sessions.listPendingSessionsForMachine,
      { sessionId, machineId }
    );
    expect(pending.some((s) => s._id === rowId)).toBe(true);
  });

  test('does not return session after association', async () => {
    const { sessionId, machineId, workspaceId } = await setupWorkspaceForSession('lpsfm-assoc');
    const { sessionId: rowId } = await createSession(sessionId, workspaceId);

    await t.mutation(
      api.chatroom.directHarness.sessions.associateHarnessSessionId,
      { sessionId, harnessSessionRowId: rowId, harnessSessionId: 'sdk-abc' }
    );

    const pending = await t.query(
      api.chatroom.directHarness.sessions.listPendingSessionsForMachine,
      { sessionId, machineId }
    );
    expect(pending.some((s) => s._id === rowId)).toBe(false);
  });

  test('does not return sessions for a different machine', async () => {
    const { sessionId, workspaceId } = await setupWorkspaceForSession('lpsfm-other');
    const { sessionId: rowId } = await createSession(sessionId, workspaceId);

    const pending = await t.query(
      api.chatroom.directHarness.sessions.listPendingSessionsForMachine,
      { sessionId, machineId: 'other-machine' }
    );
    expect(pending.length).toBe(0);
  });

  test('returns [] on auth failure', async () => {
    const { machineId } = await setupWorkspaceForSession('lpsfm-auth');

    const pending = await t.query(
      api.chatroom.directHarness.sessions.listPendingSessionsForMachine,
      { sessionId: 'invalid-session' as SessionId, machineId }
    );
    expect(pending).toEqual([]);
  });
});
