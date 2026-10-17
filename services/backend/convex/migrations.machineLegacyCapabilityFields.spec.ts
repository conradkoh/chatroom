/**
 * Migration: unsetMachineLegacyCapabilityFields
 *
 * Removes the dead legacy capability/liveness fields from chatroom_machines so
 * machine reads stop carrying the stale payload. Live capabilities live in
 * chatroom_machineCapabilities and recency in chatroom_machineLiveness.
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { t } from '../test.setup';
import { api, internal } from './_generated/api';

const LEGACY_FIELDS = [
  'availableModels',
  'availableHarnesses',
  'harnessVersions',
  'lastSeenAt',
] as const;

async function createTestSession(id: string) {
  const login = await t.mutation(api.auth.loginAnon, { sessionId: id as SessionId });
  expect(login.success).toBe(true);
  return id as SessionId;
}

/**
 * Run one full pass of the migration. `reset` forces a fresh pass so each test
 * exercises `migrateOne` for the rows it seeds, even though the shared test DB
 * persists across tests in this file.
 */
async function runMigration() {
  return await t.mutation(internal.migrations.unsetMachineLegacyCapabilityFields, {
    cursor: null,
    batchSize: 100,
    reset: true,
  });
}

async function registerMachine(sessionId: SessionId, machineId: string) {
  await t.mutation(api.machines.register, {
    sessionId,
    machineId,
    hostname: `${machineId}-host`,
    os: 'linux',
    availableHarnesses: ['opencode'],
    availableModels: { opencode: ['openai/gpt-4'] },
    harnessVersions: { opencode: { version: '1.2.3', major: 1 } },
  });
}

function readMachine(machineId: string) {
  return t.run(async (ctx) => {
    return await ctx.db
      .query('chatroom_machines')
      .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
      .unique();
  });
}

describe('migration: unsetMachineLegacyCapabilityFields', () => {
  test('removes the four legacy fields and preserves every kept field', async () => {
    const sessionId = await createTestSession('migration-legacy-fields');
    const machineId = 'migration-legacy-fields-machine';
    await registerMachine(sessionId, machineId);

    const seeded = await t.run(async (ctx) => {
      const machine = await ctx.db
        .query('chatroom_machines')
        .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
        .unique();
      if (!machine) throw new Error('machine not found');
      await ctx.db.patch('chatroom_machines', machine._id, {
        alias: 'legacy-box',
        lastCapabilitiesRefreshRequestedAt: 1_700_000_000_000,
        availableModels: { opencode: ['openai/gpt-4'] },
        availableHarnesses: ['opencode'],
        harnessVersions: { opencode: { version: '1.2.3', major: 1 } },
        lastSeenAt: 1_600_000_000_000,
      });
      return await ctx.db.get('chatroom_machines', machine._id);
    });
    expect(seeded).not.toBeNull();

    await runMigration();

    const after = await readMachine(machineId);
    expect(after).not.toBeNull();
    for (const field of LEGACY_FIELDS) {
      expect(after).not.toHaveProperty(field);
    }
    expect(after).toMatchObject({
      machineId,
      hostname: `${machineId}-host`,
      os: 'linux',
      alias: 'legacy-box',
      lastCapabilitiesRefreshRequestedAt: 1_700_000_000_000,
      registeredAt: seeded!.registeredAt,
      userId: seeded!.userId,
    });
  });

  test('leaves a machine without legacy fields untouched', async () => {
    const sessionId = await createTestSession('migration-no-legacy-fields');
    const machineId = 'migration-no-legacy-fields-machine';
    await registerMachine(sessionId, machineId);

    const before = await readMachine(machineId);
    expect(before).not.toBeNull();
    for (const field of LEGACY_FIELDS) {
      expect(before).not.toHaveProperty(field);
    }

    await runMigration();

    const after = await readMachine(machineId);
    expect(after).toEqual(before);
  });

  test('requireMachineOwner still succeeds for the owner after the migration', async () => {
    const sessionId = await createTestSession('migration-owner-check');
    const machineId = 'migration-owner-check-machine';
    await registerMachine(sessionId, machineId);

    await t.run(async (ctx) => {
      const machine = await ctx.db
        .query('chatroom_machines')
        .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
        .unique();
      if (!machine) throw new Error('machine not found');
      await ctx.db.patch('chatroom_machines', machine._id, {
        availableModels: { opencode: ['openai/gpt-4'] },
        lastSeenAt: 1_600_000_000_000,
      });
    });

    await runMigration();

    // markDaemonOnline runs requireMachineOwner before touching machine status.
    await expect(
      t.mutation(api.machines.markDaemonOnline, { sessionId, machineId })
    ).resolves.toEqual({ success: true });
  });

  test('register and refreshCapabilities never write the legacy fields onto the machine row', async () => {
    const sessionId = await createTestSession('migration-no-legacy-writes');
    const machineId = 'migration-no-legacy-writes-machine';

    await registerMachine(sessionId, machineId);
    const afterRegister = await readMachine(machineId);
    expect(afterRegister).not.toBeNull();
    for (const field of LEGACY_FIELDS) {
      expect(afterRegister).not.toHaveProperty(field);
    }

    await t.mutation(api.machines.refreshCapabilities, {
      sessionId,
      machineId,
      availableHarnesses: ['opencode'],
      harnessVersions: { opencode: { version: '1.2.3', major: 1 } },
      availableModels: { opencode: ['openai/gpt-4'] },
    });

    const afterRefresh = await readMachine(machineId);
    expect(afterRefresh).not.toBeNull();
    for (const field of LEGACY_FIELDS) {
      expect(afterRefresh).not.toHaveProperty(field);
    }
  });

  test('re-registering a machine patches only hostname and os', async () => {
    const sessionId = await createTestSession('migration-reregister-identity');
    const machineId = 'migration-reregister-identity-machine';
    await registerMachine(sessionId, machineId);

    const before = await readMachine(machineId);
    expect(before).not.toBeNull();

    await t.mutation(api.machines.register, {
      sessionId,
      machineId,
      hostname: `${machineId}-host-2`,
      os: 'darwin',
      availableHarnesses: ['opencode'],
      availableModels: { opencode: ['openai/gpt-4'] },
      harnessVersions: { opencode: { version: '2.0.0', major: 2 } },
    });

    const after = await readMachine(machineId);
    expect(after).not.toBeNull();
    for (const field of LEGACY_FIELDS) {
      expect(after).not.toHaveProperty(field);
    }
    // Only the stable identity fields change; every other stored field is untouched.
    expect(after).toEqual({ ...before!, hostname: `${machineId}-host-2`, os: 'darwin' });
  });
});
