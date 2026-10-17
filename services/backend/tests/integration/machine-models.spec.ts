/**
 * Machine Models Integration Tests
 *
 * The daemon model catalog lives in `chatroom_machineAvailableModels`, split from
 * `chatroom_machineCapabilities` so the capabilities row (harnesses + versions)
 * stays small and cheap for `listMachines` / `getMachineCapabilities` readers.
 *
 * 1. register with availableModels → models row created, capabilities row has no models
 * 2. re-registering the same machine updates the models row
 * 3. refreshCapabilities writes models only to the models row
 * 4. refreshCapabilities with SAME availableModels twice → models write suppressed
 * 5. refreshCapabilities with availableModels=undefined → models row NOT clobbered
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import { t } from '../../test.setup';
import { createTestSession } from '../helpers/integration';
import { TEST_MODEL_PROVIDER_A, TEST_MODEL_PROVIDER_B } from '../helpers/test-models';

function readModelsRow(machineId: string) {
  return t.run(async (ctx) =>
    ctx.db
      .query('chatroom_machineAvailableModels')
      .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
      .first()
  );
}

function readModelsRows(machineId: string) {
  return t.run(async (ctx) =>
    ctx.db
      .query('chatroom_machineAvailableModels')
      .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
      .collect()
  );
}

function readCapabilitiesRow(machineId: string) {
  return t.run(async (ctx) =>
    ctx.db
      .query('chatroom_machineCapabilities')
      .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
      .first()
  );
}

describe('chatroom_machineAvailableModels model catalog', () => {
  test('register with availableModels writes models to the models row only', async () => {
    const { sessionId } = await createTestSession('mm-register-create');
    const machineId = 'mm-machine-register-create';
    const models = { opencode: [TEST_MODEL_PROVIDER_A, 'provider/gpt-4o'] };

    await t.mutation(api.machines.register, {
      sessionId,
      machineId,
      hostname: 'test-host',
      os: 'darwin',
      availableHarnesses: ['opencode'],
      availableModels: models,
    });

    const modelsRow = await readModelsRow(machineId);
    expect(modelsRow).not.toBeNull();
    expect(modelsRow!.machineId).toBe(machineId);
    expect(modelsRow!.availableModels).toEqual(models);
    expect(modelsRow!.updatedAt).toBeGreaterThan(0);

    const capabilities = await readCapabilitiesRow(machineId);
    expect(capabilities).not.toBeNull();
    expect(capabilities).not.toHaveProperty('availableModels');
    expect(capabilities!.availableHarnesses).toEqual(['opencode']);
  });

  test('re-registering the same machine updates the models row and keeps one row', async () => {
    const { sessionId } = await createTestSession('mm-register-update');
    const machineId = 'mm-machine-register-update';
    const modelsV1 = { opencode: [TEST_MODEL_PROVIDER_A] };
    const modelsV2 = { opencode: [TEST_MODEL_PROVIDER_A, TEST_MODEL_PROVIDER_B] };

    await t.mutation(api.machines.register, {
      sessionId,
      machineId,
      hostname: 'test-host',
      os: 'darwin',
      availableHarnesses: ['opencode'],
      availableModels: modelsV1,
    });

    await t.mutation(api.machines.register, {
      sessionId,
      machineId,
      hostname: 'test-host',
      os: 'darwin',
      availableHarnesses: ['opencode'],
      availableModels: modelsV2,
    });

    const rows = await readModelsRows(machineId);
    expect(rows).toHaveLength(1);
    expect(rows[0].availableModels).toEqual(modelsV2);

    const capabilities = await readCapabilitiesRow(machineId);
    expect(capabilities).not.toHaveProperty('availableModels');
  });

  test('refreshCapabilities with availableModels writes models to the models row only', async () => {
    const { sessionId } = await createTestSession('mm-refresh-update');
    const machineId = 'mm-machine-refresh-update';
    const modelsV1 = { opencode: [TEST_MODEL_PROVIDER_A] };
    const modelsV2 = { opencode: [TEST_MODEL_PROVIDER_A, 'provider/gpt-4o'], pi: ['pi-model'] };

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

    const modelsRow = await readModelsRow(machineId);
    expect(modelsRow).not.toBeNull();
    expect(modelsRow!.availableModels).toEqual(modelsV2);

    const capabilities = await readCapabilitiesRow(machineId);
    expect(capabilities).not.toHaveProperty('availableModels');
  });

  test('refreshCapabilities with SAME availableModels twice suppresses the second models write', async () => {
    const { sessionId } = await createTestSession('mm-refresh-noop');
    const machineId = 'mm-machine-refresh-noop';
    const models = { opencode: [TEST_MODEL_PROVIDER_A] };

    await t.mutation(api.machines.register, {
      sessionId,
      machineId,
      hostname: 'test-host',
      os: 'darwin',
      availableHarnesses: ['opencode'],
      availableModels: models,
    });

    const rowAfterFirst = await readModelsRow(machineId);

    // Wait a bit to ensure updatedAt would differ if a write happened
    await new Promise((r) => setTimeout(r, 5));

    // Second refresh — identical content; the models write must be a no-op
    await t.mutation(api.machines.refreshCapabilities, {
      sessionId,
      machineId,
      availableHarnesses: ['opencode'],
      availableModels: models,
    });

    const rowAfterSecond = await readModelsRow(machineId);
    expect(rowAfterSecond!._id).toBe(rowAfterFirst!._id);
    expect(rowAfterSecond!.updatedAt).toBe(rowAfterFirst!.updatedAt);
    expect(rowAfterSecond!.availableModels).toEqual(models);
  });

  test('refreshCapabilities with availableModels=undefined does NOT clobber the models row', async () => {
    const { sessionId } = await createTestSession('mm-refresh-undefined');
    const machineId = 'mm-machine-refresh-undefined';
    const models = { opencode: [TEST_MODEL_PROVIDER_A] };

    await t.mutation(api.machines.register, {
      sessionId,
      machineId,
      hostname: 'test-host',
      os: 'darwin',
      availableHarnesses: ['opencode'],
      availableModels: models,
    });

    // Refresh without models (old daemon, or harness not yet discovered)
    await t.mutation(api.machines.refreshCapabilities, {
      sessionId,
      machineId,
      availableHarnesses: ['opencode'],
      // availableModels intentionally omitted
    });

    const modelsRow = await readModelsRow(machineId);
    expect(modelsRow).not.toBeNull();
    expect(modelsRow!.availableModels).toEqual(models);
  });
});

describe('getMachineModels query', () => {
  test('returns models from the models table when a row exists', async () => {
    const { sessionId } = await createTestSession('gmm-new-table');
    const machineId = 'gmm-machine-new-table';
    const models = { opencode: [TEST_MODEL_PROVIDER_A], pi: ['pi-model'] };

    await t.mutation(api.machines.register, {
      sessionId,
      machineId,
      hostname: 'test-host',
      os: 'darwin',
      availableHarnesses: ['opencode'],
      availableModels: models,
    });

    const result = await t.query(api.machines.getMachineModels, { sessionId, machineId });
    expect(result.availableModels).toEqual(models);
  });

  test('falls back to the deprecated capabilities field when the models row is absent', async () => {
    const { sessionId } = await createTestSession('gmm-legacy-fallback');
    const machineId = 'gmm-machine-legacy-fallback';
    const models = { opencode: ['provider/legacy-model'] };

    // Register without models, then simulate a pre-migration row that still has
    // models on the capabilities row.
    await t.mutation(api.machines.register, {
      sessionId,
      machineId,
      hostname: 'test-host',
      os: 'darwin',
      availableHarnesses: ['opencode'],
    });
    await t.run(async (ctx) => {
      const capabilities = await ctx.db
        .query('chatroom_machineCapabilities')
        .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
        .first();
      await ctx.db.patch(capabilities!._id, { availableModels: models });
    });

    const result = await t.query(api.machines.getMachineModels, { sessionId, machineId });
    expect(result.availableModels).toEqual(models);
  });

  test('does not read the legacy models field on the machine parent row', async () => {
    const { sessionId } = await createTestSession('gmm-machine-parent-field');
    const machineId = 'gmm-machine-parent-field';
    const models = { opencode: ['provider/legacy-model'] };

    await t.mutation(api.machines.register, {
      sessionId,
      machineId,
      hostname: 'test-host',
      os: 'darwin',
      availableHarnesses: ['opencode'],
    });

    // Manually patch the legacy field on chatroom_machines to simulate a
    // pre-migration machine that has models on the parent row only.
    await t.run(async (ctx) => {
      const machine = await ctx.db
        .query('chatroom_machines')
        .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
        .first();
      await ctx.db.patch('chatroom_machines', machine!._id, { availableModels: models });
    });

    const result = await t.query(api.machines.getMachineModels, { sessionId, machineId });
    // The legacy parent field is migration input only and is not read at runtime.
    expect(result.availableModels).toEqual({});
  });

  test('returns empty object when machine has no models in either location', async () => {
    const { sessionId } = await createTestSession('gmm-empty');
    const machineId = 'gmm-machine-empty';

    await t.mutation(api.machines.register, {
      sessionId,
      machineId,
      hostname: 'test-host',
      os: 'darwin',
      availableHarnesses: ['opencode'],
      // No availableModels
    });

    const result = await t.query(api.machines.getMachineModels, { sessionId, machineId });
    expect(result.availableModels).toEqual({});
  });

  test('returns empty object when sessionId is unauthenticated', async () => {
    const result = await t.query(api.machines.getMachineModels, {
      sessionId: 'not-a-real-session' as SessionId,
      machineId: 'any-machine',
    });
    expect(result.availableModels).toEqual({});
  });

  test('listMachines returns exactly the slim machine shape', async () => {
    const { sessionId } = await createTestSession('gmm-list-slim');
    const machineId = 'gmm-machine-list-slim';
    const harnessVersions = { opencode: { version: '1.2.3', major: 1 } };

    await t.mutation(api.machines.register, {
      sessionId,
      machineId,
      hostname: 'test-host',
      os: 'darwin',
      availableHarnesses: ['opencode'],
      harnessVersions,
      availableModels: { opencode: [TEST_MODEL_PROVIDER_A] },
    });
    await t.mutation(api.machines.setMachineAlias, { sessionId, machineId, alias: 'slim-box' });

    const list = await t.query(api.machines.listMachines, { sessionId });
    const m = list.machines.find((x) => x.machineId === machineId);
    expect(m).toEqual({
      machineId,
      hostname: 'test-host',
      alias: 'slim-box',
      os: 'darwin',
      availableHarnesses: ['opencode'],
      harnessVersions,
      registeredAt: expect.any(Number),
    });
  });
});
