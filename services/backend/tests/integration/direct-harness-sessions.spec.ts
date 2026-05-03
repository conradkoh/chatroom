/**
 * Direct Harness — Sessions Integration Tests
 *
 * Covers: openSession, associateHarnessSessionId, closeSession (appendMessages),
 * listPendingSessionsForMachine, listSessionsByWorkspace, updateSessionConfig (basic).
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test, beforeEach, afterEach } from 'vitest';

import { featureFlags } from '../../config/featureFlags';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { t } from '../../test.setup';
import { createTestSession, createPairTeamChatroom } from '../helpers/integration';
import { setupWorkspaceForSession, openSession, TEST_HARNESS_NAME } from './direct-harness/fixtures';

// ─── Flag management ──────────────────────────────────────────────────────────

beforeEach(() => {
  featureFlags.directHarnessWorkers = true;
});

afterEach(() => {
  featureFlags.directHarnessWorkers = false;
});

// ─── openSession ──────────────────────────────────────────────────────────────

describe('openSession', () => {
  test('creates a harness session and returns harnessSessionRowId', async () => {
    const { sessionId, workspaceId } = await setupWorkspaceForSession('open-success');

    const result = await openSession(sessionId, workspaceId);

    expect(result.harnessSessionRowId).toBeDefined();
    expect(typeof result.harnessSessionRowId).toBe('string');
  });

  test('the created session has pending status and correct fields', async () => {
    const { sessionId, workspaceId } = await setupWorkspaceForSession('open-fields');

    const { harnessSessionRowId } = await openSession(sessionId, workspaceId);

    const session = await t.query(api.chatroom.directHarness.sessions.getSession, {
      sessionId,
      harnessSessionRowId,
    });

    expect(session).toBeDefined();
    expect(session?.status).toBe('pending');
    expect(session?.harnessName).toBe(TEST_HARNESS_NAME);
    expect(session?.lastUsedConfig?.agent).toBe('builder');
    expect(session?.harnessSessionId).toBeUndefined();
  });

  test('throws when feature flag is off', async () => {
    featureFlags.directHarnessWorkers = false;

    const { sessionId, workspaceId } = await setupWorkspaceForSession('open-flag-off');

    await expect(openSession(sessionId, workspaceId)).rejects.toThrow(
      'directHarnessWorkers feature flag is disabled'
    );
  });

  test('throws when workspace is not found', async () => {
    const { sessionId } = await createTestSession('open-no-workspace');

    // Use a validly-formatted Convex ID that doesn't exist in the DB
    const fakeWorkspaceId = 'jx7aaaaaaaaaaaaaaaaaaaa4' as Id<'chatroom_workspaces'>;

    await expect(
      t.mutation(api.chatroom.directHarness.sessions.openSession, {
        sessionId,
        workspaceId: fakeWorkspaceId,
        harnessName: TEST_HARNESS_NAME,
        config: { agent: 'builder' },
        firstPrompt: { parts: [{ type: 'text' as const, text: 'hello' }] },
      })
    ).rejects.toThrow();
  });
});

// ─── openSession — atomic pending prompt creation ─────────────────────────────

describe('openSession — atomic pending prompt creation', () => {
  test('openSession creates a harness session row AND a chatroom_pendingPrompts row atomically', async () => {
    const { sessionId, workspaceId, machineId } = await setupWorkspaceForSession('open-gap-doc');
    const { harnessSessionRowId, promptId } = await openSession(sessionId, workspaceId);

    const session = await t.query(api.chatroom.directHarness.sessions.getSession, {
      sessionId,
      harnessSessionRowId,
    });
    expect(session?.status).toBe('pending');
    expect(session?.harnessSessionId).toBeUndefined();

    expect(promptId).toBeDefined();
    const claimed = await t.mutation(api.chatroom.directHarness.prompts.claimNextPendingPrompt, {
      sessionId,
      machineId,
    });
    expect(claimed).not.toBeNull();
  });
});

// ─── associateHarnessSessionId ────────────────────────────────────────────────

describe('associateHarnessSessionId', () => {
  test('sets harnessSessionId and transitions status to active', async () => {
    const { sessionId, workspaceId } = await setupWorkspaceForSession('assoc-success');
    const { harnessSessionRowId } = await openSession(sessionId, workspaceId);

    await t.mutation(api.chatroom.directHarness.sessions.associateHarnessSessionId, {
      sessionId,
      harnessSessionRowId,
      harnessSessionId: 'sdk-session-abc123',
    });

    const session = await t.query(api.chatroom.directHarness.sessions.getSession, {
      sessionId,
      harnessSessionRowId,
    });

    expect(session?.harnessSessionId).toBe('sdk-session-abc123');
    expect(session?.status).toBe('active');
  });

  test('is idempotent when the same harnessSessionId is already associated', async () => {
    const { sessionId, workspaceId } = await setupWorkspaceForSession('assoc-idem');
    const { harnessSessionRowId } = await openSession(sessionId, workspaceId);

    await t.mutation(api.chatroom.directHarness.sessions.associateHarnessSessionId, {
      sessionId,
      harnessSessionRowId,
      harnessSessionId: 'sdk-session-idempotent',
    });

    await expect(
      t.mutation(api.chatroom.directHarness.sessions.associateHarnessSessionId, {
        sessionId,
        harnessSessionRowId,
        harnessSessionId: 'sdk-session-idempotent',
      })
    ).resolves.toBeDefined();
  });

  test('throws when a different harnessSessionId is already associated', async () => {
    const { sessionId, workspaceId } = await setupWorkspaceForSession('assoc-conflict');
    const { harnessSessionRowId } = await openSession(sessionId, workspaceId);

    await t.mutation(api.chatroom.directHarness.sessions.associateHarnessSessionId, {
      sessionId,
      harnessSessionRowId,
      harnessSessionId: 'sdk-session-first',
    });

    await expect(
      t.mutation(api.chatroom.directHarness.sessions.associateHarnessSessionId, {
        sessionId,
        harnessSessionRowId,
        harnessSessionId: 'sdk-session-different',
      })
    ).rejects.toThrow('already has a different harnessSessionId');
  });
});

// ─── appendMessages ───────────────────────────────────────────────────────────

describe('appendMessages', () => {
  test('inserts chunks and returns correct counts', async () => {
    const { sessionId, workspaceId } = await setupWorkspaceForSession('append-success');
    const { harnessSessionRowId } = await openSession(sessionId, workspaceId);

    const result = await t.mutation(api.chatroom.directHarness.messages.appendMessages, {
      sessionId,
      harnessSessionRowId,
      chunks: [
        { seq: 0, content: 'Hello', timestamp: 1000 },
        { seq: 1, content: ' world', timestamp: 1001 },
      ],
    });

    expect(result.inserted).toBe(2);
    expect(result.skipped).toBe(0);
  });

  test('is idempotent on (harnessSessionRowId, seq) — duplicate chunks are skipped', async () => {
    const { sessionId, workspaceId } = await setupWorkspaceForSession('append-idem');
    const { harnessSessionRowId } = await openSession(sessionId, workspaceId);

    await t.mutation(api.chatroom.directHarness.messages.appendMessages, {
      sessionId,
      harnessSessionRowId,
      chunks: [{ seq: 0, content: 'first', timestamp: 1000 }],
    });

    const result = await t.mutation(api.chatroom.directHarness.messages.appendMessages, {
      sessionId,
      harnessSessionRowId,
      chunks: [
        { seq: 0, content: 'duplicate', timestamp: 1001 },
        { seq: 1, content: 'new', timestamp: 1002 },
      ],
    });

    expect(result.inserted).toBe(1);
    expect(result.skipped).toBe(1);
  });
});

// ─── updateSessionConfig (basic) ─────────────────────────────────────────────

describe('updateSessionConfig', () => {
  test('updates the agent field on a session', async () => {
    const { sessionId, workspaceId } = await setupWorkspaceForSession('update-agent');

    const { harnessSessionRowId } = await openSession(sessionId, workspaceId, 'builder');

    await t.mutation(api.chatroom.directHarness.sessions.updateSessionConfig, {
      sessionId,
      harnessSessionRowId,
      config: { agent: 'planner' },
    });

    const session = await t.query(api.chatroom.directHarness.sessions.getSession, {
      sessionId,
      harnessSessionRowId,
    });

    expect(session?.lastUsedConfig?.agent).toBe('planner');
  });
});

// ─── listSessionsByWorkspace ──────────────────────────────────────────────────

describe('listSessionsByWorkspace', () => {
  test('returns sessions in creation order', async () => {
    const { sessionId, workspaceId } = await setupWorkspaceForSession('list-sessions');

    await openSession(sessionId, workspaceId, 'builder');
    await openSession(sessionId, workspaceId, 'planner');

    const sessions = await t.query(api.chatroom.directHarness.sessions.listSessionsByWorkspace, {
      sessionId,
      workspaceId,
    });

    expect(sessions).toHaveLength(2);
    expect(sessions[0]?.lastUsedConfig?.agent).toBe('builder');
    expect(sessions[1]?.lastUsedConfig?.agent).toBe('planner');
    expect(sessions[0]!.createdAt).toBeLessThanOrEqual(sessions[1]!.createdAt);
  });
});

// ─── listPendingSessionsForMachine ───────────────────────────────────────────

describe('listPendingSessionsForMachine', () => {
  test('returns pending sessions for the machine', async () => {
    const { sessionId, machineId, workspaceId } = await setupWorkspaceForSession('lpsfm-basic');

    const { harnessSessionRowId } = await openSession(sessionId, workspaceId);

    const pending = await t.query(
      api.chatroom.directHarness.sessions.listPendingSessionsForMachine,
      { sessionId, machineId }
    );

    expect(pending.some((s) => s._id === harnessSessionRowId)).toBe(true);
  });

  test('does NOT return a session once associateHarnessSessionId is called', async () => {
    const { sessionId, machineId, workspaceId } = await setupWorkspaceForSession('lpsfm-assoc');
    const { harnessSessionRowId } = await openSession(sessionId, workspaceId);

    await t.mutation(api.chatroom.directHarness.sessions.associateHarnessSessionId, {
      sessionId,
      harnessSessionRowId,
      harnessSessionId: 'harness-abc',
    });

    const pending = await t.query(
      api.chatroom.directHarness.sessions.listPendingSessionsForMachine,
      { sessionId, machineId }
    );

    expect(pending.some((s) => s._id === harnessSessionRowId)).toBe(false);
  });

  test('does NOT return sessions for a different machine', async () => {
    const { sessionId, workspaceId } = await setupWorkspaceForSession('lpsfm-other');
    const { harnessSessionRowId } = await openSession(sessionId, workspaceId);

    const pending = await t.query(
      api.chatroom.directHarness.sessions.listPendingSessionsForMachine,
      { sessionId, machineId: 'other-machine-does-not-exist' }
    );

    expect(pending.some((s) => s._id === harnessSessionRowId)).toBe(false);
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
