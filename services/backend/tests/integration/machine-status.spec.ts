/**
 * Machine Status Integration Tests
 *
 * Tests for materialized machine status (chatroom_machineStatus):
 * 1. Heartbeat creates machineStatus as online when no row exists
 * 2. Heartbeat flips offline→online immediately
 * 3. Heartbeat does NOT write when already online (write suppression)
 * 4. Cron transitions online→offline when heartbeat expired
 * 5. Cron skips machines already offline
 * 6. Queries read from machineStatus not machineLiveness
 */

import { describe, expect, test } from 'vitest';

import { DAEMON_HEARTBEAT_TTL_MS } from '../../config/reliability';
import { api, internal } from '../../convex/_generated/api';
import { t } from '../../test.setup';
import { createTestSession, registerMachineWithDaemon } from '../helpers/integration';

describe('Machine Status', () => {
  test('heartbeat creates machineStatus as online when no row exists', async () => {
    const { sessionId } = await createTestSession('test-ms-create');
    const machineId = 'machine-ms-create';

    await registerMachineWithDaemon(sessionId, machineId);

    // Send heartbeat — should create machineStatus row
    await t.mutation(api.machines.daemonHeartbeat, {
      sessionId,
      machineId,
    });

    const status = await t.run(async (ctx) => {
      return ctx.db
        .query('chatroom_machineStatus')
        .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
        .first();
    });

    expect(status).not.toBeNull();
    expect(status!.status).toBe('online');
    expect(status!.machineId).toBe(machineId);
    expect(status!.lastTransitionAt).toBeGreaterThan(0);
  });

  test('heartbeat flips offline→online immediately', async () => {
    const { sessionId } = await createTestSession('test-ms-flip');
    const machineId = 'machine-ms-flip';

    await registerMachineWithDaemon(sessionId, machineId);

    // Create an initial heartbeat to get the machineStatus row
    await t.mutation(api.machines.daemonHeartbeat, {
      sessionId,
      machineId,
    });

    // Manually set status to offline
    await t.run(async (ctx) => {
      const status = await ctx.db
        .query('chatroom_machineStatus')
        .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
        .first();
      if (status) {
        await ctx.db.patch(status._id, { status: 'offline', lastTransitionAt: 1000 });
      }
    });

    // Send heartbeat — should flip to online
    await t.mutation(api.machines.daemonHeartbeat, {
      sessionId,
      machineId,
    });

    const status = await t.run(async (ctx) => {
      return ctx.db
        .query('chatroom_machineStatus')
        .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
        .first();
    });

    expect(status!.status).toBe('online');
    expect(status!.lastTransitionAt).toBeGreaterThan(1000);
  });

  test('heartbeat does NOT write when already online (write suppression)', async () => {
    const { sessionId } = await createTestSession('test-ms-suppress');
    const machineId = 'machine-ms-suppress';

    await registerMachineWithDaemon(sessionId, machineId);

    // Send first heartbeat to create machineStatus as online
    await t.mutation(api.machines.daemonHeartbeat, {
      sessionId,
      machineId,
    });

    // Record the lastTransitionAt
    const before = await t.run(async (ctx) => {
      const status = await ctx.db
        .query('chatroom_machineStatus')
        .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
        .first();
      return status!.lastTransitionAt;
    });

    // Small delay
    await new Promise((r) => setTimeout(r, 10));

    // Send another heartbeat — should NOT write to machineStatus
    await t.mutation(api.machines.daemonHeartbeat, {
      sessionId,
      machineId,
    });

    const after = await t.run(async (ctx) => {
      const status = await ctx.db
        .query('chatroom_machineStatus')
        .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
        .first();
      return status!.lastTransitionAt;
    });

    // lastTransitionAt should be unchanged — no write occurred
    expect(after).toBe(before);
  });

  test('cron transitions online→offline when heartbeat expired', async () => {
    const { sessionId } = await createTestSession('test-ms-cron-offline');
    const machineId = 'machine-ms-cron-offline';

    await registerMachineWithDaemon(sessionId, machineId);

    // Send heartbeat to create machineStatus as online
    await t.mutation(api.machines.daemonHeartbeat, {
      sessionId,
      machineId,
    });

    // Set liveness lastSeenAt to be expired
    const expiredTime = Date.now() - DAEMON_HEARTBEAT_TTL_MS - 1;
    await t.run(async (ctx) => {
      const liveness = await ctx.db
        .query('chatroom_machineLiveness')
        .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
        .first();
      if (liveness) {
        await ctx.db.patch(liveness._id, { lastSeenAt: expiredTime });
      }
    });

    // Run the actual cron mutation
    await t.mutation(internal.machineStatusCron.transitionOfflineMachines, {});

    const status = await t.run(async (ctx) => {
      return ctx.db
        .query('chatroom_machineStatus')
        .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
        .first();
    });

    expect(status!.status).toBe('offline');
  });

  test('cron skips machines already offline', async () => {
    const { sessionId } = await createTestSession('test-ms-cron-skip');
    const machineId = 'machine-ms-cron-skip';

    await registerMachineWithDaemon(sessionId, machineId);

    // Send heartbeat to create machineStatus, then set to offline
    await t.mutation(api.machines.daemonHeartbeat, {
      sessionId,
      machineId,
    });

    const setTime = 5000;
    await t.run(async (ctx) => {
      const status = await ctx.db
        .query('chatroom_machineStatus')
        .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
        .first();
      if (status) {
        await ctx.db.patch(status._id, { status: 'offline', lastTransitionAt: setTime });
      }
    });

    // Run the actual cron mutation — should not touch offline machines
    await t.mutation(internal.machineStatusCron.transitionOfflineMachines, {});

    const status = await t.run(async (ctx) => {
      return ctx.db
        .query('chatroom_machineStatus')
        .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
        .first();
    });

    // lastTransitionAt should be unchanged — cron didn't touch it
    expect(status!.status).toBe('offline');
    expect(status!.lastTransitionAt).toBe(setTime);
  });

  test('queries read from machineStatus not machineLiveness', async () => {
    const { sessionId } = await createTestSession('test-ms-query-source');
    const machineId = 'machine-ms-query-source';

    await registerMachineWithDaemon(sessionId, machineId);

    // Send heartbeat to create machineStatus as online
    await t.mutation(api.machines.daemonHeartbeat, {
      sessionId,
      machineId,
    });

    // Set machineLiveness to disconnected (stale data)
    await t.run(async (ctx) => {
      const liveness = await ctx.db
        .query('chatroom_machineLiveness')
        .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
        .first();
      if (liveness) {
        await ctx.db.patch(liveness._id, { daemonConnected: false });
      }
    });

    // machineStatus is still "online" — queries should show connected
    const result = await t.query(api.machines.listMachines, { sessionId });
    const machine = result.machines.find((m) => m.machineId === machineId);

    expect(machine).toBeDefined();
    expect(machine!.daemonConnected).toBe(true);
  });
});
