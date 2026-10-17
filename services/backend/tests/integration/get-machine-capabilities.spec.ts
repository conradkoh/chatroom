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
    const harnessVersions = { opencode: { version: '1.2.3', major: 1 } };
    const models = { opencode: ['provider/model'] };

    await t.mutation(api.machines.register, {
      sessionId,
      machineId,
      hostname: 'test-host',
      os: 'darwin',
      availableHarnesses: ['opencode'],
      harnessVersions,
      availableModels: models,
    });

    const result = await t.query(api.machines.getMachineCapabilities, {
      sessionId,
      machineId,
    });

    expect(result).toEqual({
      availableHarnesses: ['opencode'],
      harnessVersions,
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
    const modelsV1 = { opencode: ['provider/v1'] };
    const modelsV2 = { opencode: ['provider/v2'] };

    await t.mutation(api.machines.register, {
      sessionId,
      machineId,
      hostname: 'test-host',
      os: 'darwin',
      availableHarnesses: ['opencode'],
      availableModels: modelsV1,
    });
    await t.mutation(api.machines.refreshCapabilities, {
      sessionId,
      machineId,
      availableHarnesses: ['opencode'],
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
      availableHarnesses: ['opencode'],
    });

    const foreignResult = await t.query(api.machines.getMachineCapabilities, {
      sessionId: otherSessionId,
      machineId,
    });
    const unknownResult = await t.query(api.machines.getMachineCapabilities, {
      sessionId: otherSessionId,
      machineId: 'machine-capabilities-unknown',
    });

    expect(foreignResult).toEqual({ availableHarnesses: [], harnessVersions: {} });
    expect(unknownResult).toEqual({ availableHarnesses: [], harnessVersions: {} });
  });
});
