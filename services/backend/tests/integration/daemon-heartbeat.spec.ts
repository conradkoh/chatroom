/**
 * Daemon Heartbeat Integration Tests
 *
 * Tests for daemon heartbeat liveness detection:
 * 1. daemonHeartbeat mutation updates lastSeenAt
 * 2. Stale daemon is marked disconnected by cleanupStaleMachines
 * 3. daemonHeartbeat recovers disconnected daemon
 * 4. Fresh daemon is NOT marked disconnected
 */

import { describe, expect, test } from 'vitest';

import { DAEMON_HEARTBEAT_TTL_MS } from '../../config/reliability';
import { api, internal } from '../../convex/_generated/api';
import { t } from '../../test.setup';
import { createTestSession, registerMachineWithDaemon } from '../helpers/integration';

describe('Daemon Heartbeat', () => {
  test('daemonHeartbeat mutation updates lastSeenAt', async () => {
    const { sessionId } = await createTestSession('test-hb-1');
    const machineId = 'machine-hb-1';

    // Register machine (sets initial lastSeenAt)
    await registerMachineWithDaemon(sessionId, machineId);

    // Read initial lastSeenAt
    const before = await t.run(async (ctx) => {
      const machine = await ctx.db
        .query('chatroom_machines')
        .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
        .first();
      return machine!.lastSeenAt;
    });

    // Small delay to ensure Date.now() advances
    await new Promise((r) => setTimeout(r, 10));

    // Send heartbeat
    await t.mutation(api.machines.daemonHeartbeat, {
      sessionId,
      machineId,
    });

    // Read updated lastSeenAt
    const after = await t.run(async (ctx) => {
      const machine = await ctx.db
        .query('chatroom_machines')
        .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
        .first();
      return machine!.lastSeenAt;
    });

    expect(after).toBeGreaterThan(before);
  });

  test('stale daemon is marked disconnected by cleanupStaleMachines', async () => {
    const { sessionId } = await createTestSession('test-hb-2');
    const machineId = 'machine-hb-2';

    // Register machine with daemon connected
    await registerMachineWithDaemon(sessionId, machineId);

    // Manually set lastSeenAt to be older than TTL (simulate stale daemon)
    await t.run(async (ctx) => {
      const machine = await ctx.db
        .query('chatroom_machines')
        .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
        .first();
      await ctx.db.patch(machine!._id, {
        lastSeenAt: Date.now() - DAEMON_HEARTBEAT_TTL_MS - 10_000,
      });
    });

    // Verify daemon is still marked as connected before cleanup
    const beforeCleanup = await t.run(async (ctx) => {
      const machine = await ctx.db
        .query('chatroom_machines')
        .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
        .first();
      return machine!.daemonConnected;
    });
    expect(beforeCleanup).toBe(true);

    // Run cleanup
    await t.mutation(internal.tasks.cleanupStaleMachines, {});

    // Verify daemon is now marked as disconnected
    const afterCleanup = await t.run(async (ctx) => {
      const machine = await ctx.db
        .query('chatroom_machines')
        .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
        .first();
      return machine!.daemonConnected;
    });
    expect(afterCleanup).toBe(false);
  });

  test('daemonHeartbeat recovers disconnected daemon (Plan 026)', async () => {
    const { sessionId } = await createTestSession('test-hb-recovery');
    const machineId = 'machine-hb-recovery';

    // Register machine with daemon connected
    await registerMachineWithDaemon(sessionId, machineId);

    // Manually mark daemon as disconnected (simulating cleanup after transient issue)
    await t.run(async (ctx) => {
      const machine = await ctx.db
        .query('chatroom_machines')
        .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
        .first();
      await ctx.db.patch(machine!._id, {
        daemonConnected: false,
      });
    });

    // Verify daemon is disconnected
    const beforeHeartbeat = await t.run(async (ctx) => {
      const machine = await ctx.db
        .query('chatroom_machines')
        .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
        .first();
      return machine!.daemonConnected;
    });
    expect(beforeHeartbeat).toBe(false);

    // Send heartbeat — should recover daemonConnected to true
    await t.mutation(api.machines.daemonHeartbeat, {
      sessionId,
      machineId,
    });

    // Verify daemon is now connected again
    const afterHeartbeat = await t.run(async (ctx) => {
      const machine = await ctx.db
        .query('chatroom_machines')
        .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
        .first();
      return machine!.daemonConnected;
    });
    expect(afterHeartbeat).toBe(true);
  });

  test('fresh daemon is NOT marked disconnected by cleanupStaleMachines', async () => {
    const { sessionId } = await createTestSession('test-hb-4');
    const machineId = 'machine-hb-4';

    // Register machine with daemon connected (lastSeenAt = now)
    await registerMachineWithDaemon(sessionId, machineId);

    // Run cleanup
    await t.mutation(internal.tasks.cleanupStaleMachines, {});

    // Verify daemon is still marked as connected
    const afterCleanup = await t.run(async (ctx) => {
      const machine = await ctx.db
        .query('chatroom_machines')
        .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
        .first();
      return machine!.daemonConnected;
    });
    expect(afterCleanup).toBe(true);
  });
});
