/**
 * Machine-scoped auth regression tests for daemon directHarness endpoints.
 */

import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { featureFlags } from '../../config/featureFlags';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { t } from '../../test.setup';
import { createTestSession } from '../helpers/integration';
import { setupWorkspaceForSession } from './direct-harness/fixtures';

beforeEach(() => {
  featureFlags.directHarnessWorkers = true;
});

afterEach(() => {
  featureFlags.directHarnessWorkers = false;
});

describe('daemon directHarness machine auth', () => {
  test('listPendingCommands rejects caller without owner access to machineId', async () => {
    const { sessionId, machineId, workspaceId } =
      await setupWorkspaceForSession('dh-auth-list');

    await t.run(async (ctx) => {
      await ctx.db.insert('chatroom_directHarnessCommands', {
        machineId,
        workspaceId,
        type: 'refreshCapabilities',
        refreshCapabilities: { initiatedBy: 'test' },
        status: 'pending',
        createdAt: Date.now(),
      });
    });

    const { sessionId: otherSession } = await createTestSession('dh-auth-list-other');

    await expect(
      t.query(api.daemon.directHarness.commands.listPendingCommands, {
        sessionId: otherSession,
        machineId,
      })
    ).rejects.toThrow(/NOT_AUTHORIZED_MACHINE/);
  });

  test('updateCommandStatus rejects command owned by another machine', async () => {
    const { machineId: victimMachineId, workspaceId } =
      await setupWorkspaceForSession('dh-auth-update-victim');
    const { sessionId: attackerSession, machineId: attackerMachineId } =
      await setupWorkspaceForSession('dh-auth-update-attacker');

    const commandId = await t.run(async (ctx) => {
      return await ctx.db.insert('chatroom_directHarnessCommands', {
        machineId: victimMachineId,
        workspaceId,
        type: 'refreshCapabilities',
        refreshCapabilities: { initiatedBy: 'test' },
        status: 'pending',
        createdAt: Date.now(),
      });
    });

    await expect(
      t.mutation(api.daemon.directHarness.commands.updateCommandStatus, {
        sessionId: attackerSession,
        commandId: commandId as Id<'chatroom_directHarnessCommands'>,
        status: 'inProgress',
      })
    ).rejects.toThrow(/NOT_AUTHORIZED_MACHINE/);

    expect(attackerMachineId).not.toBe(victimMachineId);
  });
});
