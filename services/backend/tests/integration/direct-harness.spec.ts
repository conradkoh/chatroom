/**
 * Direct Harness Integration Tests
 *
 * Tests for the direct-harness feature: HarnessSessions and
 * HarnessSessionMessages backed by the chatroom_workspaces table.
 *
 * The directHarnessWorkers feature flag is temporarily enabled via direct
 * object mutation; it is reset after each test.
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test, beforeEach, afterEach } from 'vitest';

import { api } from '../../convex/_generated/api';
import { featureFlags } from '../../config/featureFlags';
import { t } from '../../test.setup';
import {
  createTestSession,
  createPairTeamChatroom,
  registerMachineWithDaemon,
} from '../helpers/integration';

// ─── Flag management ──────────────────────────────────────────────────────────

beforeEach(() => {
  featureFlags.directHarnessWorkers = true;
});

afterEach(() => {
  featureFlags.directHarnessWorkers = false;
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TEST_CWD = '/home/test/repo';
const TEST_HARNESS_NAME = 'opencode-sdk';

/**
 * Set up a session, chatroom, machine, and registered workspace.
 * Returns everything needed to call openSession.
 */
async function setupWorkspaceForSession(prefix: string) {
  const { sessionId } = await createTestSession(`${prefix}-session`);
  const chatroomId = await createPairTeamChatroom(sessionId);
  const machineId = `${prefix}-machine`;

  await registerMachineWithDaemon(sessionId, machineId);

  // Register the workspace (links machine + cwd to the chatroom)
  await t.mutation(api.workspaces.registerWorkspace, {
    sessionId,
    chatroomId,
    machineId,
    workingDir: TEST_CWD,
    hostname: 'test-host',
    registeredBy: 'builder',
  });

  return { sessionId, chatroomId, machineId };
}

// ─── openSession ──────────────────────────────────────────────────────────────

describe('openSession', () => {
  test('creates a harness session and returns harnessSessionRowId', async () => {
    const { sessionId, chatroomId, machineId } = await setupWorkspaceForSession('open-success');

    const result = await t.mutation(api.chatroom.directHarness.sessions.openSession, {
      sessionId,
      chatroomId,
      machineId,
      cwd: TEST_CWD,
      harnessName: TEST_HARNESS_NAME,
      agent: 'builder',
    });

    expect(result.harnessSessionRowId).toBeDefined();
    expect(typeof result.harnessSessionRowId).toBe('string');
  });

  test('the created session has pending status and correct fields', async () => {
    const { sessionId, chatroomId, machineId } = await setupWorkspaceForSession('open-fields');

    const { harnessSessionRowId } = await t.mutation(
      api.chatroom.directHarness.sessions.openSession,
      {
        sessionId,
        chatroomId,
        machineId,
        cwd: TEST_CWD,
        harnessName: TEST_HARNESS_NAME,
        agent: 'builder',
      }
    );

    const session = await t.query(api.chatroom.directHarness.sessions.getSession, {
      sessionId,
      harnessSessionRowId,
    });

    expect(session).toBeDefined();
    expect(session?.status).toBe('pending');
    expect(session?.harnessName).toBe(TEST_HARNESS_NAME);
    expect(session?.agent).toBe('builder');
    expect(session?.harnessSessionId).toBeUndefined();
  });

  test('throws when feature flag is off', async () => {
    featureFlags.directHarnessWorkers = false;

    const { sessionId, chatroomId, machineId } = await setupWorkspaceForSession('open-flag-off');

    await expect(
      t.mutation(api.chatroom.directHarness.sessions.openSession, {
        sessionId,
        chatroomId,
        machineId,
        cwd: TEST_CWD,
        harnessName: TEST_HARNESS_NAME,
        agent: 'builder',
      })
    ).rejects.toThrow('directHarnessWorkers feature flag is disabled');
  });

  test('throws when no workspace is registered for the chatroom + machine + cwd', async () => {
    const { sessionId } = await createTestSession('open-no-workspace');
    const chatroomId = await createPairTeamChatroom(sessionId);
    const machineId = 'nonexistent-machine';

    await expect(
      t.mutation(api.chatroom.directHarness.sessions.openSession, {
        sessionId,
        chatroomId,
        machineId,
        cwd: '/not/registered',
        harnessName: TEST_HARNESS_NAME,
        agent: 'builder',
      })
    ).rejects.toThrow('No active workspace found');
  });
});

// ─── associateHarnessSessionId ────────────────────────────────────────────────

describe('associateHarnessSessionId', () => {
  async function openSession(sessionId: SessionId, chatroomId: any, machineId: string) {
    return t.mutation(api.chatroom.directHarness.sessions.openSession, {
      sessionId,
      chatroomId,
      machineId,
      cwd: TEST_CWD,
      harnessName: TEST_HARNESS_NAME,
      agent: 'builder',
    });
  }

  test('sets harnessSessionId and transitions status to active', async () => {
    const { sessionId, chatroomId, machineId } = await setupWorkspaceForSession('assoc-success');
    const { harnessSessionRowId } = await openSession(sessionId, chatroomId, machineId);

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
    const { sessionId, chatroomId, machineId } = await setupWorkspaceForSession('assoc-idem');
    const { harnessSessionRowId } = await openSession(sessionId, chatroomId, machineId);

    await t.mutation(api.chatroom.directHarness.sessions.associateHarnessSessionId, {
      sessionId,
      harnessSessionRowId,
      harnessSessionId: 'sdk-session-idempotent',
    });

    // Second call with same ID should not throw
    await expect(
      t.mutation(api.chatroom.directHarness.sessions.associateHarnessSessionId, {
        sessionId,
        harnessSessionRowId,
        harnessSessionId: 'sdk-session-idempotent',
      })
    ).resolves.toBeDefined(); // Convex returns null for void mutations
  });

  test('throws when a different harnessSessionId is already associated', async () => {
    const { sessionId, chatroomId, machineId } = await setupWorkspaceForSession('assoc-conflict');
    const { harnessSessionRowId } = await openSession(sessionId, chatroomId, machineId);

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
  async function openSession(sessionId: SessionId, chatroomId: any, machineId: string) {
    return t.mutation(api.chatroom.directHarness.sessions.openSession, {
      sessionId,
      chatroomId,
      machineId,
      cwd: TEST_CWD,
      harnessName: TEST_HARNESS_NAME,
      agent: 'builder',
    });
  }

  test('inserts chunks and returns correct counts', async () => {
    const { sessionId, chatroomId, machineId } = await setupWorkspaceForSession('append-success');
    const { harnessSessionRowId } = await openSession(sessionId, chatroomId, machineId);

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
    const { sessionId, chatroomId, machineId } = await setupWorkspaceForSession('append-idem');
    const { harnessSessionRowId } = await openSession(sessionId, chatroomId, machineId);

    // First insert
    await t.mutation(api.chatroom.directHarness.messages.appendMessages, {
      sessionId,
      harnessSessionRowId,
      chunks: [{ seq: 0, content: 'first', timestamp: 1000 }],
    });

    // Second insert with same seq — should skip
    const result = await t.mutation(api.chatroom.directHarness.messages.appendMessages, {
      sessionId,
      harnessSessionRowId,
      chunks: [
        { seq: 0, content: 'duplicate', timestamp: 1001 }, // duplicate
        { seq: 1, content: 'new', timestamp: 1002 },        // new
      ],
    });

    expect(result.inserted).toBe(1);
    expect(result.skipped).toBe(1);
  });
});

// ─── updateSessionAgent ───────────────────────────────────────────────────────

describe('updateSessionAgent', () => {
  test('updates the agent field on a session', async () => {
    const { sessionId, chatroomId, machineId } = await setupWorkspaceForSession('update-agent');

    const { harnessSessionRowId } = await t.mutation(
      api.chatroom.directHarness.sessions.openSession,
      {
        sessionId,
        chatroomId,
        machineId,
        cwd: TEST_CWD,
        harnessName: TEST_HARNESS_NAME,
        agent: 'builder',
      }
    );

    await t.mutation(api.chatroom.directHarness.sessions.updateSessionAgent, {
      sessionId,
      harnessSessionRowId,
      agent: 'planner',
    });

    const session = await t.query(api.chatroom.directHarness.sessions.getSession, {
      sessionId,
      harnessSessionRowId,
    });

    expect(session?.agent).toBe('planner');
  });
});

// ─── listSessionsByWorkspace ──────────────────────────────────────────────────

describe('listSessionsByWorkspace', () => {
  test('returns sessions in creation order', async () => {
    const { sessionId, chatroomId, machineId } = await setupWorkspaceForSession('list-sessions');

    // Open two sessions
    await t.mutation(api.chatroom.directHarness.sessions.openSession, {
      sessionId,
      chatroomId,
      machineId,
      cwd: TEST_CWD,
      harnessName: TEST_HARNESS_NAME,
      agent: 'builder',
    });

    await t.mutation(api.chatroom.directHarness.sessions.openSession, {
      sessionId,
      chatroomId,
      machineId,
      cwd: TEST_CWD,
      harnessName: TEST_HARNESS_NAME,
      agent: 'planner',
    });

    // Find workspace id via listWorkspacesForMachine
    const workspaces = await t.query(api.workspaces.listWorkspacesForMachine, {
      sessionId,
      machineId,
    });
    const workspace = workspaces.find(
      (w) => w.workingDir === TEST_CWD && w.chatroomId === chatroomId
    );
    expect(workspace).toBeDefined();

    const sessions = await t.query(api.chatroom.directHarness.sessions.listSessionsByWorkspace, {
      sessionId,
      workspaceId: workspace!._id,
    });

    expect(sessions).toHaveLength(2);
    expect(sessions[0]?.agent).toBe('builder');
    expect(sessions[1]?.agent).toBe('planner');
    // Verify ascending order
    expect(sessions[0]!.createdAt).toBeLessThanOrEqual(sessions[1]!.createdAt);
  });
});
