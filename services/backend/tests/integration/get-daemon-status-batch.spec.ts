/**
 * getDaemonStatusesBatch Integration Tests
 *
 * Tests for batched daemon status query:
 * 1. Returns connectivity for multiple machines in one subscription
 * 2. Unauthorized machine IDs return disconnected
 */

import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import { t } from '../../test.setup';
import { createTestSession, registerMachineWithDaemon } from '../helpers/integration';

describe('getDaemonStatusesBatch', () => {
  test('returns connectivity for multiple machines in one subscription', async () => {
    const { sessionId } = await createTestSession('test-batch-1');
    const machineId1 = 'machine-batch-1';
    const machineId2 = 'machine-batch-2';

    // Register two machines with daemon connected
    await registerMachineWithDaemon(sessionId, machineId1);
    await registerMachineWithDaemon(sessionId, machineId2);

    // Query both machine IDs in a single batch
    const result = await t.query(api.machines.getDaemonStatusesBatch, {
      sessionId,
      machineIds: [machineId1, machineId2],
    });

    expect(result.statuses).toHaveLength(2);

    const status1 = result.statuses.find((s) => s.machineId === machineId1)!;
    const status2 = result.statuses.find((s) => s.machineId === machineId2)!;

    expect(status1.connected).toBe(true);
    expect(status1.lastSeenAt).toBeTypeOf('number');

    expect(status2.connected).toBe(true);
    expect(status2.lastSeenAt).toBeTypeOf('number');
  });

  test('unauthorized machine ID returns connected: false', async () => {
    const { sessionId } = await createTestSession('test-batch-auth');
    const ownedMachineId = 'machine-batch-auth-owned';
    const unauthorizedMachineId = 'machine-batch-auth-unauthorized';

    // Register one machine for this user
    await registerMachineWithDaemon(sessionId, ownedMachineId);

    // Query with both owned and unauthorized machine IDs
    const result = await t.query(api.machines.getDaemonStatusesBatch, {
      sessionId,
      machineIds: [ownedMachineId, unauthorizedMachineId],
    });

    expect(result.statuses).toHaveLength(2);

    const ownedStatus = result.statuses.find((s) => s.machineId === ownedMachineId)!;
    const unauthorizedStatus = result.statuses.find((s) => s.machineId === unauthorizedMachineId)!;

    expect(ownedStatus.connected).toBe(true);

    expect(unauthorizedStatus.connected).toBe(false);
    expect(unauthorizedStatus.lastSeenAt).toBe(null);
  });

  test('truncates to MAX_DAEMON_STATUS_BATCH (10) machines', async () => {
    const { sessionId } = await createTestSession('test-batch-limit');

    // Register 15 machines
    const machineIds: string[] = [];
    for (let i = 0; i < 15; i++) {
      const mid = `machine-batch-limit-${i}`;
      machineIds.push(mid);
      await registerMachineWithDaemon(sessionId, mid);
    }

    // Query all 15 — should be truncated to 10
    const result = await t.query(api.machines.getDaemonStatusesBatch, {
      sessionId,
      machineIds,
    });

    expect(result.statuses).toHaveLength(10);
    expect(result.statuses[0].machineId).toBe(machineIds[0]);
    expect(result.statuses[9].machineId).toBe(machineIds[9]);
  });

  test('empty machineIds returns empty statuses', async () => {
    const { sessionId } = await createTestSession('test-batch-empty');

    const result = await t.query(api.machines.getDaemonStatusesBatch, {
      sessionId,
      machineIds: [],
    });

    expect(result.statuses).toHaveLength(0);
  });
});
