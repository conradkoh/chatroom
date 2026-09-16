/**
 * listMachineConnectivity Integration Tests
 *
 * Tests for the user-scoped connectivity query:
 * 1. Returns connectivity for all of the user's machines
 * 2. A different user's session sees no machines
 */

import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import { t } from '../../test.setup';
import { createTestSession, registerMachineWithDaemon } from '../helpers/integration';

describe('listMachineConnectivity', () => {
  test('returns connectivity for all of the user machines', async () => {
    const { sessionId } = await createTestSession('test-connectivity-1');
    const machineId1 = 'machine-connectivity-1';
    const machineId2 = 'machine-connectivity-2';

    await registerMachineWithDaemon(sessionId, machineId1);
    await registerMachineWithDaemon(sessionId, machineId2);

    const result = await t.query(api.machines.listMachineConnectivity, { sessionId });

    expect(result.machines).toHaveLength(2);
    expect(result.machines).toEqual(
      expect.arrayContaining([
        { machineId: machineId1, connected: true },
        { machineId: machineId2, connected: true },
      ])
    );
  });

  test('another user session does not see machines it does not own', async () => {
    const { sessionId: ownerSessionId } = await createTestSession('test-connectivity-owner');
    const { sessionId: otherSessionId } = await createTestSession('test-connectivity-other');

    await registerMachineWithDaemon(ownerSessionId, 'machine-connectivity-owned');

    const ownerResult = await t.query(api.machines.listMachineConnectivity, {
      sessionId: ownerSessionId,
    });
    const otherResult = await t.query(api.machines.listMachineConnectivity, {
      sessionId: otherSessionId,
    });

    expect(ownerResult.machines).toEqual([
      { machineId: 'machine-connectivity-owned', connected: true },
    ]);
    expect(otherResult.machines).toEqual([]);
  });
});
