/**
 * Direct Harness — Config Validation Integration Tests
 *
 * Covers: updateSessionConfig with validation edge cases (registry present/absent,
 * known/unknown agents).
 */

import { describe, expect, test, beforeEach, afterEach } from 'vitest';

import { featureFlags } from '../../config/featureFlags';
import { api } from '../../convex/_generated/api';
import { t } from '../../test.setup';
import { setupWorkspaceForSession, openSession, TEST_CWD } from './direct-harness/fixtures';

// ─── Flag management ──────────────────────────────────────────────────────────

beforeEach(() => {
  featureFlags.directHarnessWorkers = true;
});

afterEach(() => {
  featureFlags.directHarnessWorkers = false;
});

// ─── updateSessionConfig (with validation) ────────────────────────────────────

describe('updateSessionConfig (with validation)', () => {
  test('updates agent when registry has no agent list (harness not booted yet)', async () => {
    const { sessionId, workspaceId } = await setupWorkspaceForSession('update-agent-no-registry');
    const { harnessSessionRowId } = await openSession(sessionId, workspaceId, 'builder');

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
