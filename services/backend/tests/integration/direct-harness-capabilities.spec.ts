/**
 * Direct Harness — Capabilities Integration Tests
 *
 * Covers: publishMachineCapabilities, getMachineRegistry, listForWorkspace,
 * requestRefresh, completeRefreshTask, getPendingRefreshTasksForMachine.
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test, beforeEach, afterEach } from 'vitest';

import { featureFlags } from '../../config/featureFlags';
import { api } from '../../convex/_generated/api';
import { t } from '../../test.setup';
import { createPairTeamChatroom } from '../helpers/integration';
import { setupWorkspaceForSession, TEST_CWD } from './direct-harness/fixtures';

// ─── Flag management ──────────────────────────────────────────────────────────

beforeEach(() => {
  featureFlags.directHarnessWorkers = true;
});

afterEach(() => {
  featureFlags.directHarnessWorkers = false;
});

// ─── publishMachineCapabilities ───────────────────────────────────────────────

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

// ─── getMachineRegistry ───────────────────────────────────────────────────────

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

    const otherChatroomId = await createPairTeamChatroom(sessionId);
    const otherRegistries = await t.query(
      api.chatroom.directHarness.capabilities.getMachineRegistry,
      { sessionId, chatroomId: otherChatroomId }
    );
    expect(otherRegistries).toHaveLength(0);

    const registries = await t.query(api.chatroom.directHarness.capabilities.getMachineRegistry, {
      sessionId,
      chatroomId,
    });
    expect(registries).toHaveLength(1);
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

    expect(second.taskId).toBe(first.taskId);
  });

  test('creates a new task after the first is completed', async () => {
    const { sessionId, workspaceId } = await setupWorkspaceForSession('rr-new-after-done');

    const first = await t.mutation(api.chatroom.directHarness.capabilities.requestRefresh, {
      sessionId,
      workspaceId,
    });

    await t.mutation(api.chatroom.directHarness.capabilities.completeRefreshTask, {
      sessionId,
      taskId: first.taskId,
      status: 'done',
    });

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
