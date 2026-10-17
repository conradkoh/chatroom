/**
 * Migration: migrateMachineAvailableModelsToTable
 *
 * Copies `chatroom_machineCapabilities.availableModels` into
 * `chatroom_machineAvailableModels` and unsets the legacy field in the same
 * mutation. An existing row in the new table always wins.
 */

import { describe, expect, test } from 'vitest';

import { t } from '../test.setup';
import { internal } from './_generated/api';

/** Force a fresh pass so each test exercises `migrateOne` for the rows it seeds. */
async function runMigration() {
  return await t.mutation(internal.migrations.migrateMachineAvailableModelsToTable, {
    cursor: null,
    batchSize: 5,
    reset: true,
  });
}

function readRows(machineId: string) {
  return t.run(async (ctx) => {
    const capabilities = await ctx.db
      .query('chatroom_machineCapabilities')
      .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
      .first();
    const modelsRow = await ctx.db
      .query('chatroom_machineAvailableModels')
      .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
      .first();
    return { capabilities, modelsRow };
  });
}

function countNewRows(machineId: string) {
  return t.run(async (ctx) =>
    ctx.db
      .query('chatroom_machineAvailableModels')
      .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
      .collect()
  );
}

describe('migration: migrateMachineAvailableModelsToTable', () => {
  test('copies models to the new table and unsets the legacy field in place', async () => {
    const machineId = 'mam-copy-unset';
    const models = { opencode: ['a/b', 'c/d'], pi: ['p/e'] };
    await t.run(async (ctx) => {
      await ctx.db.insert('chatroom_machineCapabilities', {
        machineId,
        lastSeenAt: 1_700_000_000_000,
        availableHarnesses: ['opencode'],
        harnessVersions: { opencode: { version: '1.2.3', major: 1 } },
        availableModels: models,
        workspaces: [{ workspaceId: 'ws-1', cwd: '/tmp/ws-1', name: 'ws-1' }],
        updatedAt: 1_650_000_000_000,
      });
    });

    await runMigration();

    const { capabilities, modelsRow } = await readRows(machineId);
    expect(modelsRow).not.toBeNull();
    expect(modelsRow!.availableModels).toEqual(models);
    expect(modelsRow!.updatedAt).toBe(1_650_000_000_000);

    expect(capabilities).not.toBeNull();
    expect(capabilities).not.toHaveProperty('availableModels');
    expect(capabilities!.lastSeenAt).toBe(1_700_000_000_000);
    expect(capabilities!.availableHarnesses).toEqual(['opencode']);
    expect(capabilities!.harnessVersions).toEqual({ opencode: { version: '1.2.3', major: 1 } });
    expect(capabilities!.workspaces).toHaveLength(1);
  });

  test('does not overwrite an existing new-table row', async () => {
    const machineId = 'mam-existing-wins';
    const legacyModels = { opencode: ['legacy/model'] };
    const freshModels = { opencode: ['fresh/model'] };
    await t.run(async (ctx) => {
      await ctx.db.insert('chatroom_machineCapabilities', {
        machineId,
        lastSeenAt: 1_700_000_000_000,
        availableModels: legacyModels,
        updatedAt: 1_650_000_000_000,
      });
      await ctx.db.insert('chatroom_machineAvailableModels', {
        machineId,
        availableModels: freshModels,
        updatedAt: 1_660_000_000_000,
      });
    });

    await runMigration();

    const { capabilities, modelsRow } = await readRows(machineId);
    expect(modelsRow!.availableModels).toEqual(freshModels);
    expect(modelsRow!.updatedAt).toBe(1_660_000_000_000);
    expect(capabilities).not.toHaveProperty('availableModels');
  });

  test('is idempotent: running twice leaves exactly one new row', async () => {
    const machineId = 'mam-idempotent';
    const models = { opencode: ['a/b'] };
    await t.run(async (ctx) => {
      await ctx.db.insert('chatroom_machineCapabilities', {
        machineId,
        lastSeenAt: 1_700_000_000_000,
        availableModels: models,
        updatedAt: 1_650_000_000_000,
      });
    });

    await runMigration();
    await runMigration();

    const rows = await countNewRows(machineId);
    expect(rows).toHaveLength(1);
    expect(rows[0].availableModels).toEqual(models);
  });

  test('rows without models are skipped', async () => {
    const machineId = 'mam-no-models';
    await t.run(async (ctx) => {
      await ctx.db.insert('chatroom_machineCapabilities', {
        machineId,
        lastSeenAt: 1_700_000_000_000,
        availableHarnesses: ['opencode'],
        updatedAt: 1_650_000_000_000,
      });
    });

    await runMigration();

    expect(await countNewRows(machineId)).toHaveLength(0);
  });
});
