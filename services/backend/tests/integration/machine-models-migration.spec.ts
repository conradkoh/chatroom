/**
 * Migration: dropEmbeddedAvailableModels
 *
 * Tests that the migration correctly:
 * 1. Clears availableModels from rows that have it set.
 * 2. Skips rows that already have availableModels === undefined (idempotent).
 */

import { describe, expect, test } from 'vitest';

import { internal } from '../../convex/_generated/api';
import { t } from '../../test.setup';
import { createTestSession } from '../helpers/integration';
import { TEST_MODEL_PROVIDER_A } from '../helpers/test-models';

describe('migration: dropEmbeddedAvailableModels', () => {
  test('clears availableModels from machines that have the field set', async () => {
    const { sessionId: _sessionId } = await createTestSession('migrate-clear');
    const machineId = 'migrate-machine-clear';

    // Register with models (populates chatroom_machines.availableModels legacy field)
    // Use t.run to insert directly with the legacy field — register now dual-writes
    // the new table too, but we still need to verify the migration clears the legacy field.
    await t.run(async (ctx) => {
      // Get the user created by createTestSession
      const user = await ctx.db.query('users').first();
      await ctx.db.insert('chatroom_machines', {
        machineId,
        userId: user!._id,
        hostname: 'test-host',
        os: 'darwin',
        availableHarnesses: ['opencode'],
        availableModels: { opencode: [TEST_MODEL_PROVIDER_A] },
        registeredAt: Date.now(),
        lastSeenAt: Date.now(),
        daemonConnected: false,
      });
    });

    // Confirm the field is set before migration
    const before = await t.run(async (ctx) =>
      ctx.db
        .query('chatroom_machines')
        .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
        .first()
    );
    expect((before as Record<string, unknown>)['availableModels']).toBeDefined();

    // Run the migration
    await t.mutation(internal.migrations.dropEmbeddedAvailableModels, {
      cursor: null,
      batchSize: 100,
    });

    // Confirm the field is cleared
    const after = await t.run(async (ctx) =>
      ctx.db
        .query('chatroom_machines')
        .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
        .first()
    );
    expect((after as Record<string, unknown>)['availableModels']).toBeUndefined();
  });

  test('skips rows that already have availableModels undefined (idempotent)', async () => {
    const { sessionId: _sessionId } = await createTestSession('migrate-skip');
    const machineId = 'migrate-machine-skip';

    // Register without models (no legacy field)
    await t.run(async (ctx) => {
      const user = await ctx.db.query('users').first();
      await ctx.db.insert('chatroom_machines', {
        machineId,
        userId: user!._id,
        hostname: 'test-host',
        os: 'darwin',
        availableHarnesses: ['opencode'],
        // No availableModels
        registeredAt: Date.now(),
        lastSeenAt: Date.now(),
        daemonConnected: false,
      });
    });

    // Run migration — should return without patching this row
    const result = await t.mutation(internal.migrations.dropEmbeddedAvailableModels, {
      cursor: null,
      batchSize: 100,
    });

    // Migration should succeed
    expect(result).toBeDefined();

    // Row should still not have availableModels (was already clean)
    const after = await t.run(async (ctx) =>
      ctx.db
        .query('chatroom_machines')
        .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
        .first()
    );
    expect((after as Record<string, unknown>)['availableModels']).toBeUndefined();
  });
});
