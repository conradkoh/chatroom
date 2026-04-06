/**
 * Daemon Heartbeat Integration Tests
 *
 * Tests for daemon heartbeat liveness detection:
 * 1. daemonHeartbeat mutation updates lastSeenAt
 * 2. daemonHeartbeat recovers a disconnected daemon (self-healing)
 */

import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import { t } from '../../test.setup';
import { createTestSession, registerMachineWithDaemon } from '../helpers/integration';

describe('Daemon Heartbeat', () => {
  test('daemonHeartbeat mutation updates lastSeenAt in liveness table', async () => {
    const { sessionId } = await createTestSession('test-hb-1');
    const machineId = 'machine-hb-1';

    // Register machine (sets initial lastSeenAt)
    await registerMachineWithDaemon(sessionId, machineId);

    // Send first heartbeat to create liveness record
    await t.mutation(api.machines.daemonHeartbeat, {
      sessionId,
      machineId,
    });

    // Read initial lastSeenAt from liveness table
    const before = await t.run(async (ctx) => {
      const liveness = await ctx.db
        .query('chatroom_machineLiveness')
        .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
        .first();
      return liveness!.lastSeenAt;
    });

    // Small delay to ensure Date.now() advances
    await new Promise((r) => setTimeout(r, 10));

    // Send another heartbeat
    await t.mutation(api.machines.daemonHeartbeat, {
      sessionId,
      machineId,
    });

    // Read updated lastSeenAt from liveness table
    const after = await t.run(async (ctx) => {
      const liveness = await ctx.db
        .query('chatroom_machineLiveness')
        .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
        .first();
      return liveness!.lastSeenAt;
    });

    expect(after).toBeGreaterThan(before);
  });

  test('daemonHeartbeat recovers disconnected daemon in liveness table (self-healing)', async () => {
    const { sessionId } = await createTestSession('test-hb-recovery');
    const machineId = 'machine-hb-recovery';

    // Register machine with daemon connected
    await registerMachineWithDaemon(sessionId, machineId);

    // Send first heartbeat to create liveness record
    await t.mutation(api.machines.daemonHeartbeat, {
      sessionId,
      machineId,
    });

    // Manually mark daemon as disconnected in liveness table
    await t.run(async (ctx) => {
      const liveness = await ctx.db
        .query('chatroom_machineLiveness')
        .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
        .first();
      if (liveness) {
        await ctx.db.patch(liveness._id, { daemonConnected: false });
      }
    });

    // Verify daemon is disconnected in liveness table
    const beforeHeartbeat = await t.run(async (ctx) => {
      const liveness = await ctx.db
        .query('chatroom_machineLiveness')
        .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
        .first();
      return liveness!.daemonConnected;
    });
    expect(beforeHeartbeat).toBe(false);

    // Send heartbeat — should recover daemonConnected to true
    await t.mutation(api.machines.daemonHeartbeat, {
      sessionId,
      machineId,
    });

    // Verify daemon is now connected again in liveness table
    const afterHeartbeat = await t.run(async (ctx) => {
      const liveness = await ctx.db
        .query('chatroom_machineLiveness')
        .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
        .first();
      return liveness!.daemonConnected;
    });
    expect(afterHeartbeat).toBe(true);
  });

  test('daemonHeartbeat does NOT update chatroom_machines doc', async () => {
    const { sessionId } = await createTestSession('test-hb-noupdate');
    const machineId = 'machine-hb-noupdate';

    await registerMachineWithDaemon(sessionId, machineId);

    // Read machine doc state before heartbeat
    const beforeMachine = await t.run(async (ctx) => {
      const machine = await ctx.db
        .query('chatroom_machines')
        .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
        .first();
      return { lastSeenAt: machine!.lastSeenAt };
    });

    await new Promise((r) => setTimeout(r, 10));

    // Send heartbeat
    await t.mutation(api.machines.daemonHeartbeat, { sessionId, machineId });

    // Verify machine doc lastSeenAt is NOT updated
    const afterMachine = await t.run(async (ctx) => {
      const machine = await ctx.db
        .query('chatroom_machines')
        .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
        .first();
      return { lastSeenAt: machine!.lastSeenAt };
    });

    // Machine doc should NOT have been updated by heartbeat
    expect(afterMachine.lastSeenAt).toBe(beforeMachine.lastSeenAt);
  });
});
