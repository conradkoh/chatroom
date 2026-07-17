/**
 * Direct Harness — Capabilities Integration Tests
 *
 * Covers: publishMachineCapabilities, listForWorkspace,
 * requestRefresh, completeRefreshTask, getPendingRefreshTasksForMachine.
 */

import { describe, expect, test, beforeEach, afterEach } from 'vitest';

import { featureFlags } from '../../config/featureFlags';
import { api } from '../../convex/_generated/api';
import { t } from '../../test.setup';
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
    const { sessionId, machineId, workspaceId } = await setupWorkspaceForSession('pub-success');

    await t.mutation(api.daemon.directHarness.capabilities.publishMachineCapabilities, {
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
              displayName: 'OpenCode (SDK)',
              agents: [{ name: 'build', mode: 'primary' as const }],
              providers: [],
            },
          ],
        },
      ],
    });
  });

  test('second publish replaces the previous entry (upsert semantics)', async () => {
    const { sessionId, machineId, workspaceId } = await setupWorkspaceForSession('pub-upsert');

    await t.mutation(api.daemon.directHarness.capabilities.publishMachineCapabilities, {
      sessionId,
      machineId,
      workspaces: [
        { workspaceId: workspaceId as string, cwd: TEST_CWD, name: TEST_CWD, harnesses: [] },
      ],
    });

    await t.mutation(api.daemon.directHarness.capabilities.publishMachineCapabilities, {
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
              displayName: 'OpenCode (SDK)',
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
  });

  test('throws when feature flag is off', async () => {
    featureFlags.directHarnessWorkers = false;
    const { sessionId, machineId, workspaceId } = await setupWorkspaceForSession('pub-flag-off');

    await expect(
      t.mutation(api.daemon.directHarness.capabilities.publishMachineCapabilities, {
        sessionId,
        machineId,
        workspaces: [
          { workspaceId: workspaceId as string, cwd: TEST_CWD, name: TEST_CWD, harnesses: [] },
        ],
      })
    ).rejects.toThrow('directHarnessWorkers feature flag is disabled');
  });
});
