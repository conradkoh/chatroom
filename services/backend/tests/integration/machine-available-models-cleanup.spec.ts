/**
 * Machine available-models cleanup
 *
 * `chatroomCleanup.cleanupMachines` must delete the `chatroom_machineAvailableModels`
 * row together with the machine, on both the machine-delete path and the orphan
 * capabilities path.
 */

import { describe, expect, test } from 'vitest';

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

describe('machine available-models cleanup', () => {
  test('deleting a stale machine deletes its models row', async () => {
    const { sessionId } = await createTestSession('mam-cleanup-machine');
    const machineId = 'machine-mam-cleanup';
    await t.mutation(api.machines.register, {
      sessionId,
      machineId,
      hostname: 'test-host',
      os: 'darwin',
      availableHarnesses: ['opencode'],
      availableModels: { opencode: ['a/b'] },
    });

    expect(await readModelsRows(machineId)).toHaveLength(1);

    await ageCapabilities(machineId);
    await t.mutation(internal.chatroomCleanup.cleanupMachines, {});

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
        availableModels: { opencode: ['a/b'] },
        updatedAt: Date.now(),
      });
    });

    await t.mutation(internal.chatroomCleanup.cleanupMachines, {});

    expect(await readModelsRows(machineId)).toHaveLength(0);
    expect(await readCapabilitiesRows(machineId)).toHaveLength(0);
  });
});
