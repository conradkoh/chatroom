/**
 * Machine available-models cleanup
 *
 * `chatroomCleanup.cleanupMachines` starts a shared machine deletion for stale
 * machines, so the `chatroom_machineAvailableModels` row and the capabilities
 * projection end up removed on the scheduled purge path. Orphan capabilities rows
 * (no machine) are still cleaned inline together with their models row.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { api, internal } from '../../convex/_generated/api';
import { t } from '../../test.setup';
import { createTestSession } from '../helpers/integration';

const NINETY_ONE_DAYS_MS = 91 * 24 * 60 * 60 * 1000;

function readModelsRows(machineId: string) {
  return t.run(async (ctx) =>
    ctx.db
      .query('chatroom_machineAvailableModels')
      .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
      .collect()
  );
}

function readCapabilitiesRows(machineId: string) {
  return t.run(async (ctx) =>
    ctx.db
      .query('chatroom_machineCapabilities')
      .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
      .collect()
  );
}

async function ageCapabilities(machineId: string) {
  await t.run(async (ctx) => {
    const capabilities = await ctx.db
      .query('chatroom_machineCapabilities')
      .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
      .first();
    await ctx.db.patch(capabilities!._id, { lastSeenAt: Date.now() - NINETY_ONE_DAYS_MS });
  });
}

/**
 * Run every scheduler chain started by the mutation under test (the machine
 * deletion purge is scheduled, not inline) until no work remains.
 */
async function drainScheduler(): Promise<void> {
  await t.finishAllScheduledFunctions(() => vi.runAllTimers());
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('machine available-models cleanup', () => {
  test('deleting a stale machine deletes its models row', async () => {
    const { sessionId } = await createTestSession('mam-cleanup-machine');
    const machineId = 'machine-mam-cleanup';
    await t.mutation(api.machines.register, {
      sessionId,
      machineId,
      hostname: 'test-host',
      os: 'darwin',
      availableHarnesses: ['opencode-sdk'],
      availableModels: { 'opencode-sdk': ['a/b'] },
    });

    expect(await readModelsRows(machineId)).toHaveLength(1);

    await ageCapabilities(machineId);
    await t.mutation(internal.chatroomCleanup.cleanupMachines, {});
    await drainScheduler();

    expect(await readModelsRows(machineId)).toHaveLength(0);
    expect(await readCapabilitiesRows(machineId)).toHaveLength(0);
  });

  test('orphan capabilities cleanup deletes the models row', async () => {
    const machineId = 'machine-mam-cleanup-orphan';

    // No chatroom_machines parent: an orphan capabilities row with an old lastSeenAt.
    await t.run(async (ctx) => {
      await ctx.db.insert('chatroom_machineCapabilities', {
        machineId,
        lastSeenAt: Date.now() - NINETY_ONE_DAYS_MS,
        updatedAt: Date.now(),
      });
      await ctx.db.insert('chatroom_machineAvailableModels', {
        machineId,
        availableModels: { 'opencode-sdk': ['a/b'] },
        updatedAt: Date.now(),
      });
    });

    await t.mutation(internal.chatroomCleanup.cleanupMachines, {});
    await drainScheduler();

    expect(await readModelsRows(machineId)).toHaveLength(0);
    expect(await readCapabilitiesRows(machineId)).toHaveLength(0);
  });
});
