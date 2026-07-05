/**
 * Machine Models Integration Tests
 *
 * Tests for the chatroom_machineModels dual-write behaviour introduced in v1.38.4.
 * The new table holds per-machine available model lists separately from the
 * parent chatroom_machines row to prevent heavy payload re-pushes on listMachines.
 *
 * 1. register with availableModels → chatroom_machineModels row created
 * 2. refreshCapabilities with availableModels → chatroom_machineModels row updated
 * 3. refreshCapabilities with SAME availableModels twice → write suppressed (no-op)
 * 4. refreshCapabilities with availableModels=undefined → existing row NOT clobbered
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import { t } from '../../test.setup';
import { createTestSession } from '../helpers/integration';
import { TEST_MODEL_PROVIDER_A, TEST_MODEL_PROVIDER_B } from '../helpers/test-models';

describe('chatroom_machineModels dual-write', () => {
  test('register with availableModels creates a chatroom_machineModels row', async () => {
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

    const row = await t.run(async (ctx) => {
      return ctx.db
        .query('chatroom_machineModels')
        .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
        .first();
    });

    expect(row).not.toBeNull();
    expect(row!.machineId).toBe(machineId);
    expect(row!.availableModels).toEqual(models);
    expect(row!.updatedAt).toBeGreaterThan(0);
  });

  test('re-registering the same machine updates the chatroom_machineModels row', async () => {
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

    const rows = await t.run(async (ctx) => {
      return ctx.db
        .query('chatroom_machineModels')
        .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
        .collect();
    });

    // Still exactly one row
    expect(rows).toHaveLength(1);
    expect(rows[0].availableModels).toEqual(modelsV2);
  });

  test('refreshCapabilities with availableModels updates the chatroom_machineModels row', async () => {
    const { sessionId } = await createTestSession('mm-refresh-update');
    const machineId = 'mm-machine-refresh-update';
    const modelsV1 = { opencode: [TEST_MODEL_PROVIDER_A] };
    const modelsV2 = { opencode: [TEST_MODEL_PROVIDER_A, 'provider/gpt-4o'], pi: ['pi-model'] };

    // First register to create the machine
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

    const row = await t.run(async (ctx) => {
      return ctx.db
        .query('chatroom_machineModels')
        .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
        .first();
    });

    expect(row).not.toBeNull();
    expect(row!.availableModels).toEqual(modelsV2);
  });

  test('refreshCapabilities with SAME availableModels twice suppresses the second write (no-op)', async () => {
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

    // First refresh — creates / updates the row
    await t.mutation(api.machines.refreshCapabilities, {
      sessionId,
      machineId,
      availableHarnesses: ['opencode'],
      availableModels: models,
    });

    const rowAfterFirst = await t.run(async (ctx) =>
      ctx.db
        .query('chatroom_machineModels')
        .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
        .first()
    );

    // Wait a bit to ensure updatedAt would differ if a write happened
    await new Promise((r) => setTimeout(r, 5));

    // Second refresh — identical content; should be a no-op
    await t.mutation(api.machines.refreshCapabilities, {
      sessionId,
      machineId,
      availableHarnesses: ['opencode'],
      availableModels: models,
    });

    const rowAfterSecond = await t.run(async (ctx) =>
      ctx.db
        .query('chatroom_machineModels')
        .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
        .first()
    );

    // updatedAt must be unchanged — proves no write occurred
    expect(rowAfterSecond!.updatedAt).toBe(rowAfterFirst!.updatedAt);
    expect(rowAfterSecond!.availableModels).toEqual(models);
  });

  test('refreshCapabilities with availableModels=undefined does NOT clobber existing row', async () => {
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

    const row = await t.run(async (ctx) =>
      ctx.db
        .query('chatroom_machineModels')
        .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
        .first()
    );

    // Row must still exist with the original models intact
    expect(row).not.toBeNull();
    expect(row!.availableModels).toEqual(models);
  });
});

describe('getMachineModels query', () => {
  test('returns models from new chatroom_machineModels table when row exists', async () => {
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

  test('falls back to legacy field when chatroom_machineModels row is absent', async () => {
    const { sessionId } = await createTestSession('gmm-legacy-fallback');
    const machineId = 'gmm-machine-legacy-fallback';
    const models = { opencode: ['provider/legacy-model'] };

    // Register without models (so no chatroom_machineModels row is created)
    await t.mutation(api.machines.register, {
      sessionId,
      machineId,
      hostname: 'test-host',
      os: 'darwin',
      availableHarnesses: ['opencode'],
      // No availableModels — chatroom_machineModels row will NOT be created
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
    // New table row doesn't exist; should fall back to legacy field
    expect(result.availableModels).toEqual(models);
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

    // No chatroom_machineModels row was created (skipped because undefined)
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

  test('listMachines response no longer carries availableModels', async () => {
    const { sessionId } = await createTestSession('gmm-list-slim');
    const machineId = 'gmm-machine-list-slim';
    const models = { opencode: [TEST_MODEL_PROVIDER_A] };

    await t.mutation(api.machines.register, {
      sessionId,
      machineId,
      hostname: 'test-host',
      os: 'darwin',
      availableHarnesses: ['opencode'],
      availableModels: models,
    });

    const list = await t.query(api.machines.listMachines, { sessionId });
    const m = list.machines.find((x) => x.machineId === machineId);
    expect(m).toBeDefined();
    // availableModels must NOT be on the listMachines response anymore
    expect((m as Record<string, unknown>)['availableModels']).toBeUndefined();
  });
});
