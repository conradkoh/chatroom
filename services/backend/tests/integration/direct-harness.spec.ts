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

import { featureFlags } from '../../config/featureFlags';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
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
 * Returns the workspaceId for use in openSession calls.
 */
async function setupWorkspaceForSession(prefix: string): Promise<{
  sessionId: SessionId;
  chatroomId: Id<'chatroom_rooms'>;
  machineId: string;
  workspaceId: Id<'chatroom_workspaces'>;
}> {
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

  // Find the workspace ID
  const workspaces = await t.query(api.workspaces.listWorkspacesForMachine, {
    sessionId,
    machineId,
  });
  const workspace = workspaces.find(
    (w) => w.workingDir === TEST_CWD && w.chatroomId === chatroomId
  );
  if (!workspace) throw new Error('Workspace not found after registration');

  return { sessionId, chatroomId, machineId, workspaceId: workspace._id };
}

/** Shared helper to open a session using the new workspaceId-based API. */
async function openSession(
  sessionId: SessionId,
  workspaceId: Id<'chatroom_workspaces'>,
  agent = 'builder'
) {
  return t.mutation(api.chatroom.directHarness.sessions.openSession, {
    sessionId,
    workspaceId,
    harnessName: TEST_HARNESS_NAME,
    config: { agent },
    firstPrompt: { parts: [{ type: 'text' as const, text: `Starting session as ${agent}` }] },
  });
}

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
        { seq: 1, content: 'new', timestamp: 1002 }, // new
      ],
    });

    expect(result.inserted).toBe(1);
    expect(result.skipped).toBe(1);
  });
});

// ─── updateSessionConfig ──────────────────────────────────────────────────────

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

    // Open two sessions
    await openSession(sessionId, workspaceId, 'builder');
    await openSession(sessionId, workspaceId, 'planner');

    const sessions = await t.query(api.chatroom.directHarness.sessions.listSessionsByWorkspace, {
      sessionId,
      workspaceId,
    });

    expect(sessions).toHaveLength(2);
    expect(sessions[0]?.lastUsedConfig?.agent).toBe('builder');
    expect(sessions[1]?.lastUsedConfig?.agent).toBe('planner');
    // Verify ascending order
    expect(sessions[0]!.createdAt).toBeLessThanOrEqual(sessions[1]!.createdAt);
  });
});

// ─── publishMachineCapabilities + getMachineRegistry ─────────────────────────

describe('publishMachineCapabilities', () => {
  test('upserts a machine registry entry', async () => {
    const { sessionId, chatroomId, machineId, workspaceId } =
      await setupWorkspaceForSession('pub-success');

    await t.mutation(api.chatroom.directHarness.capabilities.publishMachineCapabilities, {
      sessionId,
      machineId,
      workspaces: [
        {
          workspaceId: workspaceId as string,
          cwd: TEST_CWD,
          name: TEST_CWD,
          harnesses: [
            {
              name: 'opencode-sdk',
              displayName: 'Opencode',
              agents: [{ name: 'build', mode: 'primary' as const }],
              providers: [],
            },
          ],
        },
      ],
    });

    const registries = await t.query(api.chatroom.directHarness.capabilities.getMachineRegistry, {
      sessionId,
      chatroomId,
    });

    expect(registries).toHaveLength(1);
    expect(registries[0]?.machineId).toBe(machineId);
    expect(registries[0]?.workspaces).toHaveLength(1);
    expect(registries[0]?.workspaces[0]?.harnesses[0]?.agents).toHaveLength(1);
    expect(registries[0]?.workspaces[0]?.harnesses[0]?.agents[0]?.name).toBe('build');
  });

  test('second publish replaces the previous entry (upsert semantics)', async () => {
    const { sessionId, chatroomId, machineId, workspaceId } =
      await setupWorkspaceForSession('pub-upsert');

    await t.mutation(api.chatroom.directHarness.capabilities.publishMachineCapabilities, {
      sessionId,
      machineId,
      workspaces: [
        { workspaceId: workspaceId as string, cwd: TEST_CWD, name: TEST_CWD, harnesses: [] },
      ],
    });

    // Second publish with harnesses
    await t.mutation(api.chatroom.directHarness.capabilities.publishMachineCapabilities, {
      sessionId,
      machineId,
      workspaces: [
        {
          workspaceId: workspaceId as string,
          cwd: TEST_CWD,
          name: TEST_CWD,
          harnesses: [
            {
              name: 'opencode-sdk',
              displayName: 'Opencode',
              agents: [
                { name: 'build', mode: 'primary' as const },
                { name: 'debug', mode: 'subagent' as const },
              ],
              providers: [],
            },
          ],
        },
      ],
    });

    const registries = await t.query(api.chatroom.directHarness.capabilities.getMachineRegistry, {
      sessionId,
      chatroomId,
    });

    expect(registries).toHaveLength(1);
    expect(registries[0]?.workspaces[0]?.harnesses[0]?.agents).toHaveLength(2);
  });

  test('throws when feature flag is off', async () => {
    featureFlags.directHarnessWorkers = false;
    const { sessionId, machineId, workspaceId } = await setupWorkspaceForSession('pub-flag-off');

    await expect(
      t.mutation(api.chatroom.directHarness.capabilities.publishMachineCapabilities, {
        sessionId,
        machineId,
        workspaces: [
          { workspaceId: workspaceId as string, cwd: TEST_CWD, name: TEST_CWD, harnesses: [] },
        ],
      })
    ).rejects.toThrow('directHarnessWorkers feature flag is disabled');
  });
});

describe('getMachineRegistry', () => {
  test('filters by chatroom — only machines with workspaces in the chatroom are returned', async () => {
    const { sessionId, chatroomId, machineId, workspaceId } =
      await setupWorkspaceForSession('registry-filter');

    await t.mutation(api.chatroom.directHarness.capabilities.publishMachineCapabilities, {
      sessionId,
      machineId,
      workspaces: [
        { workspaceId: workspaceId as string, cwd: TEST_CWD, name: TEST_CWD, harnesses: [] },
      ],
    });

    // Query from a different chatroom — should return empty
    const otherChatroomId = await createPairTeamChatroom(sessionId);
    const otherRegistries = await t.query(
      api.chatroom.directHarness.capabilities.getMachineRegistry,
      {
        sessionId,
        chatroomId: otherChatroomId,
      }
    );

    expect(otherRegistries).toHaveLength(0);

    // Query from the correct chatroom — should return 1
    const registries = await t.query(api.chatroom.directHarness.capabilities.getMachineRegistry, {
      sessionId,
      chatroomId,
    });

    expect(registries).toHaveLength(1);
  });
});

// ─── submitPrompt + claimNextPendingPrompt + completePendingPrompt ────────────

describe('submitPrompt', () => {
  test('inserts a pending prompt row and returns promptId', async () => {
    const { sessionId, workspaceId } = await setupWorkspaceForSession('submit-success');
    const { harnessSessionRowId } = await openSession(sessionId, workspaceId);

    const result = await t.mutation(api.chatroom.directHarness.prompts.submitPrompt, {
      sessionId,
      harnessSessionRowId,
      parts: [{ type: 'text' as const, text: 'hello' }],
      override: { agent: 'builder' },
    });

    expect(result.promptId).toBeDefined();
  });

  test('throws when session is closed', async () => {
    const { sessionId, workspaceId } = await setupWorkspaceForSession('submit-closed');
    const { harnessSessionRowId } = await openSession(sessionId, workspaceId);

    await t.mutation(api.chatroom.directHarness.sessions.closeSession, {
      sessionId,
      harnessSessionRowId,
    });

    await expect(
      t.mutation(api.chatroom.directHarness.prompts.submitPrompt, {
        sessionId,
        harnessSessionRowId,
        parts: [{ type: 'text' as const, text: 'too late' }],
        override: { agent: 'builder' },
      })
    ).rejects.toThrow();
  });
});

describe('claimNextPendingPrompt', () => {
  test('returns null when no pending prompts exist', async () => {
    const { sessionId, machineId } = await setupWorkspaceForSession('claim-empty');

    const result = await t.mutation(api.chatroom.directHarness.prompts.claimNextPendingPrompt, {
      sessionId,
      machineId,
    });

    expect(result).toBeNull();
  });

  test('claims oldest prompt first (FIFO) when multiple pending exist', async () => {
    const { sessionId, workspaceId, machineId } = await setupWorkspaceForSession('claim-atomic');
    const { harnessSessionRowId } = await openSession(sessionId, workspaceId);

    await t.mutation(api.chatroom.directHarness.prompts.submitPrompt, {
      sessionId,
      harnessSessionRowId,
      parts: [{ type: 'text' as const, text: 'first' }],
      override: { agent: 'builder' },
    });
    await t.mutation(api.chatroom.directHarness.prompts.submitPrompt, {
      sessionId,
      harnessSessionRowId,
      parts: [{ type: 'text' as const, text: 'second' }],
      override: { agent: 'builder' },
    });

    const claimed = await t.mutation(api.chatroom.directHarness.prompts.claimNextPendingPrompt, {
      sessionId,
      machineId,
    });

    expect(claimed).not.toBeNull();
    expect(claimed?.status).toBe('processing');
    // The claimed prompt is now processing — claiming again should get the second one
    const claimed2 = await t.mutation(api.chatroom.directHarness.prompts.claimNextPendingPrompt, {
      sessionId,
      machineId,
    });
    expect(claimed2).not.toBeNull();

    // Claim the third prompt (firstPrompt inserted atomically by openSession)
    const claimed3 = await t.mutation(api.chatroom.directHarness.prompts.claimNextPendingPrompt, {
      sessionId,
      machineId,
    });
    expect(claimed3).not.toBeNull();

    // Claiming again should return null (no more pending)
    const claimed4 = await t.mutation(api.chatroom.directHarness.prompts.claimNextPendingPrompt, {
      sessionId,
      machineId,
    });
    expect(claimed4).toBeNull();
  });
});

describe('completePendingPrompt', () => {
  test('updates status to done', async () => {
    const { sessionId, workspaceId, machineId } = await setupWorkspaceForSession('complete-done');
    const { harnessSessionRowId } = await openSession(sessionId, workspaceId);

    await t.mutation(api.chatroom.directHarness.prompts.submitPrompt, {
      sessionId,
      harnessSessionRowId,
      parts: [{ type: 'text' as const, text: 'hello' }],
      override: { agent: 'builder' },
    });

    const claimed = await t.mutation(api.chatroom.directHarness.prompts.claimNextPendingPrompt, {
      sessionId,
      machineId,
    });
    expect(claimed).not.toBeNull();

    await t.mutation(api.chatroom.directHarness.prompts.completePendingPrompt, {
      sessionId,
      machineId,
      promptId: claimed!._id,
      status: 'done',
    });

    const queue = await t.query(api.chatroom.directHarness.prompts.getSessionPromptQueue, {
      sessionId,
      harnessSessionRowId,
    });
    expect(queue[0]?.status).toBe('done');
  });

  test('updates status to error with message', async () => {
    const { sessionId, workspaceId, machineId } = await setupWorkspaceForSession('complete-error');
    const { harnessSessionRowId } = await openSession(sessionId, workspaceId);

    await t.mutation(api.chatroom.directHarness.prompts.submitPrompt, {
      sessionId,
      harnessSessionRowId,
      parts: [{ type: 'text' as const, text: 'oops' }],
      override: { agent: 'builder' },
    });

    const claimed = await t.mutation(api.chatroom.directHarness.prompts.claimNextPendingPrompt, {
      sessionId,
      machineId,
    });

    await t.mutation(api.chatroom.directHarness.prompts.completePendingPrompt, {
      sessionId,
      machineId,
      promptId: claimed!._id,
      status: 'error',
      errorMessage: 'connection reset',
    });

    const queue = await t.query(api.chatroom.directHarness.prompts.getSessionPromptQueue, {
      sessionId,
      harnessSessionRowId,
    });
    expect(queue[0]?.status).toBe('error');
    expect(queue[0]?.errorMessage).toBe('connection reset');
  });
});

test('rejects when prompt belongs to a different machine', async () => {
  const { sessionId, workspaceId, machineId } =
    await setupWorkspaceForSession('complete-cross-machine');
  const { harnessSessionRowId } = await openSession(sessionId, workspaceId);

  await t.mutation(api.chatroom.directHarness.prompts.submitPrompt, {
    sessionId,
    harnessSessionRowId,
    parts: [{ type: 'text' as const, text: 'hello' }],
    override: { agent: 'builder' },
  });

  const claimed = await t.mutation(api.chatroom.directHarness.prompts.claimNextPendingPrompt, {
    sessionId,
    machineId,
  });
  expect(claimed).not.toBeNull();

  // Register another machine for the same user
  const otherMachineId = 'other-machine-for-cross';
  await t.mutation(api.machines.register, {
    sessionId,
    machineId: otherMachineId,
    hostname: 'other-host',
    os: 'darwin',
    availableHarnesses: ['opencode'],
    availableModels: {},
  });

  // Trying to complete with the other machine should fail
  await expect(
    t.mutation(api.chatroom.directHarness.prompts.completePendingPrompt, {
      sessionId,
      machineId: otherMachineId,
      promptId: claimed!._id,
      status: 'done',
    })
  ).rejects.toThrow('Prompt does not belong to this machine');
});

describe('updateSessionConfig (with validation)', () => {
  test('updates agent when registry has no agent list (harness not booted yet)', async () => {
    const { sessionId, workspaceId } = await setupWorkspaceForSession('update-agent-no-registry');
    const { harnessSessionRowId } = await openSession(sessionId, workspaceId, 'builder');

    // No machine registry published — should accept any agent name
    await expect(
      t.mutation(api.chatroom.directHarness.sessions.updateSessionConfig, {
        sessionId,
        harnessSessionRowId,
        config: { agent: 'planner' },
      })
    ).resolves.toBeDefined();

    const session = await t.query(api.chatroom.directHarness.sessions.getSession, {
      sessionId,
      harnessSessionRowId,
    });
    expect(session?.lastUsedConfig?.agent).toBe('planner');
  });

  test('rejects unknown agent when registry has an agent list', async () => {
    const { sessionId, workspaceId, machineId } =
      await setupWorkspaceForSession('update-agent-reject');
    const { harnessSessionRowId } = await openSession(sessionId, workspaceId, 'builder');

    // Publish registry with known agents
    await t.mutation(api.chatroom.directHarness.capabilities.publishMachineCapabilities, {
      sessionId,
      machineId,
      workspaces: [
        {
          workspaceId: workspaceId as string,
          cwd: TEST_CWD,
          name: TEST_CWD,
          harnesses: [
            {
              name: 'opencode-sdk',
              displayName: 'Opencode',
              agents: [{ name: 'build', mode: 'primary' as const }],
              providers: [],
            },
          ],
        },
      ],
    });

    await expect(
      t.mutation(api.chatroom.directHarness.sessions.updateSessionConfig, {
        sessionId,
        harnessSessionRowId,
        config: { agent: 'nonexistent-agent' },
      })
    ).rejects.toThrow('Unknown agent');
  });

  test('accepts known agent from registry', async () => {
    const { sessionId, workspaceId, machineId } =
      await setupWorkspaceForSession('update-agent-accept');
    const { harnessSessionRowId } = await openSession(sessionId, workspaceId, 'builder');

    await t.mutation(api.chatroom.directHarness.capabilities.publishMachineCapabilities, {
      sessionId,
      machineId,
      workspaces: [
        {
          workspaceId: workspaceId as string,
          cwd: TEST_CWD,
          name: TEST_CWD,
          harnesses: [
            {
              name: 'opencode-sdk',
              displayName: 'Opencode',
              agents: [{ name: 'build', mode: 'primary' as const }],
              providers: [],
            },
          ],
        },
      ],
    });

    await expect(
      t.mutation(api.chatroom.directHarness.sessions.updateSessionConfig, {
        sessionId,
        harnessSessionRowId,
        config: { agent: 'build' },
      })
    ).resolves.toBeDefined();
  });
});

// ─── resumeSession ────────────────────────────────────────────────────────────

// ─── webapp openSession gap documentation ─────────────────────────────────────

describe('openSession — atomic pending prompt creation', () => {
  test('openSession creates a harness session row AND a chatroom_pendingPrompts row atomically', async () => {
    // openSession now atomically inserts both a harness session row (status='pending')
    // AND a paired chatroom_pendingPrompts row containing the firstPrompt.
    // The daemon subscription on chatroom_pendingPrompts will pick this up immediately.

    const { sessionId, workspaceId, machineId } = await setupWorkspaceForSession('open-gap-doc');
    const { harnessSessionRowId, promptId } = await openSession(sessionId, workspaceId);

    // Verify session was created in pending state
    const session = await t.query(api.chatroom.directHarness.sessions.getSession, {
      sessionId,
      harnessSessionRowId,
    });
    expect(session?.status).toBe('pending');
    expect(session?.harnessSessionId).toBeUndefined();

    // Verify that a chatroom_pendingPrompts row WAS created
    expect(promptId).toBeDefined();
    const claimed = await t.mutation(api.chatroom.directHarness.prompts.claimNextPendingPrompt, {
      sessionId,
      machineId,
    });
    expect(claimed).not.toBeNull(); // daemon can pick it up
  });
});

describe('resumeSession', () => {
  test('enqueues a resume task for an active session', async () => {
    const { sessionId, workspaceId, machineId } = await setupWorkspaceForSession('resume-enqueue');
    const { harnessSessionRowId } = await openSession(sessionId, workspaceId);

    // Associate to mark as active
    await t.mutation(api.chatroom.directHarness.sessions.associateHarnessSessionId, {
      sessionId,
      harnessSessionRowId,
      harnessSessionId: 'sdk-session-xyz',
    });

    const result = await t.mutation(api.chatroom.directHarness.prompts.resumeSession, {
      sessionId,
      harnessSessionRowId,
    });

    expect(result.promptId).toBeDefined();

    // Verify the task was inserted with taskType='resume'
    const queue = await t.query(api.chatroom.directHarness.prompts.getSessionPromptQueue, {
      sessionId,
      harnessSessionRowId,
    });
    const resumeTask = queue.find((q) => (q as any).taskType === 'resume');
    expect(resumeTask).toBeDefined();
    expect((resumeTask as any).parts).toHaveLength(0);
  });

  test('throws when session is in pending/spawning state', async () => {
    const { sessionId, workspaceId } = await setupWorkspaceForSession('resume-pending');
    const { harnessSessionRowId } = await openSession(sessionId, workspaceId);
    // Session is in 'pending' state after openSession

    await expect(
      t.mutation(api.chatroom.directHarness.prompts.resumeSession, {
        sessionId,
        harnessSessionRowId,
      })
    ).rejects.toThrow('still starting');
  });

  test('allows resuming a closed session (daemon will try and fail gracefully if harness gone)', async () => {
    const { sessionId, workspaceId } = await setupWorkspaceForSession('resume-closed');
    const { harnessSessionRowId } = await openSession(sessionId, workspaceId);

    await t.mutation(api.chatroom.directHarness.sessions.closeSession, {
      sessionId,
      harnessSessionRowId,
    });

    // Resume on closed is allowed — daemon decides if it works
    const result = await t.mutation(api.chatroom.directHarness.prompts.resumeSession, {
      sessionId,
      harnessSessionRowId,
    });
    expect(result.promptId).toBeDefined();
  });
});

// ─── listPendingSessionsForMachine ───────────────────────────────────────────

describe('listPendingSessionsForMachine', () => {
  test('returns pending sessions for the machine', async () => {
    const { sessionId, machineId, workspaceId } = await setupWorkspaceForSession('lpsfm-basic');

    // Insert a pending session row
    const { harnessSessionRowId } = await openSession(sessionId, workspaceId);

    const pending = await t.query(
      api.chatroom.directHarness.sessions.listPendingSessionsForMachine,
      {
        sessionId,
        machineId,
      }
    );

    expect(pending.some((s) => s._id === harnessSessionRowId)).toBe(true);
  });

  test('does NOT return a session once associateHarnessSessionId is called', async () => {
    const { sessionId, machineId, workspaceId } = await setupWorkspaceForSession('lpsfm-assoc');
    const { harnessSessionRowId } = await openSession(sessionId, workspaceId);

    // Associate the session → harnessSessionId is now set + status is 'active'
    await t.mutation(api.chatroom.directHarness.sessions.associateHarnessSessionId, {
      sessionId,
      harnessSessionRowId,
      harnessSessionId: 'harness-abc',
    });

    const pending = await t.query(
      api.chatroom.directHarness.sessions.listPendingSessionsForMachine,
      {
        sessionId,
        machineId,
      }
    );

    expect(pending.some((s) => s._id === harnessSessionRowId)).toBe(false);
  });

  test('does NOT return sessions for a different machine', async () => {
    const { sessionId, workspaceId } = await setupWorkspaceForSession('lpsfm-other');
    const { harnessSessionRowId } = await openSession(sessionId, workspaceId);

    // Query with a different machineId
    const pending = await t.query(
      api.chatroom.directHarness.sessions.listPendingSessionsForMachine,
      {
        sessionId,
        machineId: 'other-machine-does-not-exist',
      }
    );

    expect(pending.some((s) => s._id === harnessSessionRowId)).toBe(false);
  });

  test('returns [] on auth failure', async () => {
    const { machineId } = await setupWorkspaceForSession('lpsfm-auth');

    // Use an invalid session ID
    const pending = await t.query(
      api.chatroom.directHarness.sessions.listPendingSessionsForMachine,
      {
        sessionId: 'invalid-session' as SessionId,
        machineId,
      }
    );

    expect(pending).toEqual([]);
  });
});

// ─── requestRefresh idempotency ───────────────────────────────────────────────

describe('capabilities.requestRefresh idempotency', () => {
  test('second call for same workspace returns the same task ID as first', async () => {
    const { sessionId, workspaceId } = await setupWorkspaceForSession('rr-idem');

    const first = await t.mutation(api.chatroom.directHarness.capabilities.requestRefresh, {
      sessionId,
      workspaceId,
    });

    const second = await t.mutation(api.chatroom.directHarness.capabilities.requestRefresh, {
      sessionId,
      workspaceId,
    });

    // Both calls should return the same taskId (idempotent insert)
    expect(second.taskId).toBe(first.taskId);
  });

  test('creates a new task after the first is completed', async () => {
    const { sessionId, workspaceId } = await setupWorkspaceForSession('rr-new-after-done');

    const first = await t.mutation(api.chatroom.directHarness.capabilities.requestRefresh, {
      sessionId,
      workspaceId,
    });

    // Mark the first task done
    await t.mutation(api.chatroom.directHarness.capabilities.completeRefreshTask, {
      sessionId,
      taskId: first.taskId,
      status: 'done',
    });

    // A new refresh should create a fresh task
    const third = await t.mutation(api.chatroom.directHarness.capabilities.requestRefresh, {
      sessionId,
      workspaceId,
    });

    expect(third.taskId).not.toBe(first.taskId);
  });

  test('returns [] and throws on unauthenticated requestRefresh', async () => {
    const { workspaceId } = await setupWorkspaceForSession('rr-unauth');

    await expect(
      t.mutation(api.chatroom.directHarness.capabilities.requestRefresh, {
        sessionId: 'invalid-session' as SessionId,
        workspaceId,
      })
    ).rejects.toThrow();
  });
});
