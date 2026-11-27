/**
 * getMachineCapabilities Integration Tests
 *
 * Tests the per-machine daemon capability read model query.
 */

import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import { t } from '../../test.setup';
import { createTestSession } from '../helpers/integration';

describe('getMachineCapabilities', () => {
  test('returns capabilities for an owned machine', async () => {
    const { sessionId } = await createTestSession('test-machine-capabilities');
    const machineId = 'machine-capabilities-owned';
    const harnessVersions = { 'opencode-sdk': { version: '1.2.3', major: 1 } };
    const models = { 'opencode-sdk': ['provider/model'] };

    await t.mutation(api.machines.register, {
      sessionId,
      machineId,
      hostname: 'test-host',
      os: 'darwin',
      availableHarnesses: ['opencode-sdk'],
      harnessVersions,
      availableModels: models,
    });

    const result = await t.query(api.machines.getMachineCapabilities, {
      sessionId,
      machineId,
    });

    expect(result).toEqual({
      availableHarnesses: ['opencode-sdk'],
      harnessVersions,
      reported: true,
    });

    // Models are stored off the capabilities row so this reader never carries them.
    const { capabilities, modelsRow } = await t.run(async (ctx) => ({
      capabilities: await ctx.db
        .query('chatroom_machineCapabilities')
        .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
        .first(),
      modelsRow: await ctx.db
        .query('chatroom_machineAvailableModels')
        .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
        .first(),
    }));
    expect(capabilities).not.toHaveProperty('availableModels');
    expect(modelsRow!.availableModels).toEqual(models);
  });

  test('register and refreshCapabilities write models only to the models table', async () => {
    const { sessionId } = await createTestSession('test-machine-capabilities-split');
    const machineId = 'machine-capabilities-split';
    const modelsV1 = { 'opencode-sdk': ['provider/v1'] };
    const modelsV2 = { 'opencode-sdk': ['provider/v2'] };

    await t.mutation(api.machines.register, {
      sessionId,
      machineId,
      hostname: 'test-host',
      os: 'darwin',
      availableHarnesses: ['opencode-sdk'],
      availableModels: modelsV1,
    });
    await t.mutation(api.machines.refreshCapabilities, {
      sessionId,
      machineId,
      availableHarnesses: ['opencode-sdk'],
      availableModels: modelsV2,
    });

    const { capabilities, modelsRow } = await t.run(async (ctx) => ({
      capabilities: await ctx.db
        .query('chatroom_machineCapabilities')
        .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
        .first(),
      modelsRow: await ctx.db
        .query('chatroom_machineAvailableModels')
        .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
        .first(),
    }));
    expect(capabilities).not.toHaveProperty('availableModels');
    expect(modelsRow!.availableModels).toEqual(modelsV2);
  });

  test('returns empty defaults for unknown and foreign machines', async () => {
    const { sessionId: ownerSessionId } = await createTestSession(
      'test-machine-capabilities-owner'
    );
    const { sessionId: otherSessionId } = await createTestSession(
      'test-machine-capabilities-other'
    );
    const machineId = 'machine-capabilities-foreign';

    await t.mutation(api.machines.register, {
      sessionId: ownerSessionId,
      machineId,
      hostname: 'test-host',
      os: 'darwin',
      availableHarnesses: ['opencode-sdk'],
    });

    const foreignResult = await t.query(api.machines.getMachineCapabilities, {
      sessionId: otherSessionId,
      machineId,
    });
    const unknownResult = await t.query(api.machines.getMachineCapabilities, {
      sessionId: otherSessionId,
      machineId: 'machine-capabilities-unknown',
    });

    expect(foreignResult).toEqual({ availableHarnesses: [], harnessVersions: {}, reported: false });
    expect(unknownResult).toEqual({ availableHarnesses: [], harnessVersions: {}, reported: false });
  });

  test('reports false for an owned machine with no capability row', async () => {
    const { sessionId } = await createTestSession('test-machine-capabilities-norow');
    const machineId = 'machine-capabilities-norow';
    await t.mutation(api.machines.register, {
      sessionId,
      machineId,
      hostname: 'test-host',
      os: 'darwin',
      availableHarnesses: ['opencode-sdk'],
    });
    // Remove the row register just wrote, so the owned machine has no capability report.
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query('chatroom_machineCapabilities')
        .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
        .first();
      if (row) await ctx.db.delete('chatroom_machineCapabilities', row._id);
    });

    const result = await t.query(api.machines.getMachineCapabilities, { sessionId, machineId });

    expect(result).toEqual({ availableHarnesses: [], harnessVersions: {}, reported: false });
  });

  test('reports true for a reported empty harness list', async () => {
    const { sessionId } = await createTestSession('test-machine-capabilities-empty');
    const machineId = 'machine-capabilities-empty';
    await t.mutation(api.machines.register, {
      sessionId,
      machineId,
      hostname: 'test-host',
      os: 'darwin',
      availableHarnesses: [],
    });

    const result = await t.query(api.machines.getMachineCapabilities, { sessionId, machineId });

    expect(result).toEqual({ availableHarnesses: [], harnessVersions: {}, reported: true });
  });
});
