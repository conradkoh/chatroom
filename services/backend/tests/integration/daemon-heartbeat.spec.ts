/**
 * Daemon Heartbeat Integration Tests
 *
 * Tests for daemon heartbeat liveness detection:
 * 1. daemonHeartbeat mutation updates lastSeenAt
 * 2. daemonHeartbeat recovers a disconnected daemon (self-healing)
 */

import { describe, expect, test } from 'vitest';

import { DAEMON_LIVENESS_WRITE_INTERVAL_MS } from '../../config/reliability';
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
      if (!liveness) throw new Error('liveness record not found');
      return liveness.lastSeenAt;
    });

    // Send another heartbeat within throttle window — lastSeenAt should not change
    const noopResult = await t.mutation(api.machines.daemonHeartbeat, {
      sessionId,
      machineId,
    });
    expect(noopResult).toEqual({ success: true, noop: true });

    const withinWindow = await t.run(async (ctx) => {
      const liveness = await ctx.db
        .query('chatroom_machineLiveness')
        .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
        .first();
      if (!liveness) throw new Error('liveness record not found');
      return liveness.lastSeenAt;
    });

    expect(withinWindow).toBe(before);

    // Advance past DAEMON_LIVENESS_WRITE_INTERVAL_MS and heartbeat again
    const throttleMs = DAEMON_LIVENESS_WRITE_INTERVAL_MS;
    await t.run(async (ctx) => {
      const liveness = await ctx.db
        .query('chatroom_machineLiveness')
        .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
        .first();
      if (liveness) {
        await ctx.db.patch(liveness._id, {
          lastSeenAt: Date.now() - throttleMs - 1,
        });
      }
    });

    await t.mutation(api.machines.daemonHeartbeat, {
      sessionId,
      machineId,
    });

    const after = await t.run(async (ctx) => {
      const liveness = await ctx.db
        .query('chatroom_machineLiveness')
        .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
        .first();
      if (!liveness) throw new Error('liveness record not found');
      return liveness.lastSeenAt;
    });

    expect(after).toBeGreaterThan(before);
  });

  test('daemonHeartbeat recovers offline machine status (self-healing)', async () => {
    const { sessionId } = await createTestSession('test-hb-recovery');
    const machineId = 'machine-hb-recovery';

    // Register machine with daemon connected
    await registerMachineWithDaemon(sessionId, machineId);

    // Send first heartbeat to create liveness record
    await t.mutation(api.machines.daemonHeartbeat, {
      sessionId,
      machineId,
    });

    // Manually mark machine status offline.
    await t.run(async (ctx) => {
      const status = await ctx.db
        .query('chatroom_machineStatus')
        .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
        .first();
      if (status) {
        await ctx.db.patch(status._id, { status: 'offline' });
      }
    });

    // Verify machine is offline.
    const beforeHeartbeat = await t.run(async (ctx) => {
      const status = await ctx.db
        .query('chatroom_machineStatus')
        .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
        .first();
      if (!status) throw new Error('machine status not found');
      return status.status;
    });
    expect(beforeHeartbeat).toBe('offline');

    // Send heartbeat — should recover machine status to online.
    await t.mutation(api.machines.daemonHeartbeat, {
      sessionId,
      machineId,
    });

    // Verify machine is now online again.
    const afterHeartbeat = await t.run(async (ctx) => {
      const status = await ctx.db
        .query('chatroom_machineStatus')
        .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
        .first();
      if (!status) throw new Error('machine status not found');
      return status.status;
    });
    expect(afterHeartbeat).toBe('online');
  });

  test('daemonHeartbeat does NOT touch the chatroom_machines doc timestamp', async () => {
    const { sessionId } = await createTestSession('test-hb-noupdate');
    const machineId = 'machine-hb-noupdate';

    await registerMachineWithDaemon(sessionId, machineId);

    // The removed legacy field must be absent before and after heartbeat.
    const beforeMachine = await t.run(async (ctx) => {
      const machine = await ctx.db
        .query('chatroom_machines')
        .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
        .first();
      if (!machine) throw new Error('machine record not found');
      return { hasLegacyLastSeenAt: Object.prototype.hasOwnProperty.call(machine, 'lastSeenAt') };
    });

    await new Promise((r) => setTimeout(r, 10));

    // Send heartbeat
    await t.mutation(api.machines.daemonHeartbeat, { sessionId, machineId });

    const afterMachine = await t.run(async (ctx) => {
      const machine = await ctx.db
        .query('chatroom_machines')
        .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
        .first();
      if (!machine) throw new Error('machine record not found');
      return { hasLegacyLastSeenAt: Object.prototype.hasOwnProperty.call(machine, 'lastSeenAt') };
    });

    expect(beforeMachine.hasLegacyLastSeenAt).toBe(false);
    expect(afterMachine.hasLegacyLastSeenAt).toBe(false);
  });
});
