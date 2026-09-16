/**
 * getUserMachines Integration Tests
 *
 * Tests the cold, narrow machine registry query.
 */

import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import { t } from '../../test.setup';
import { createTestSession, registerMachineWithDaemon } from '../helpers/integration';

describe('getUserMachines', () => {
  test('returns registered machines with narrow metadata only', async () => {
    const { sessionId } = await createTestSession('test-user-machines');
    const machineId = 'machine-user-machines';

    await registerMachineWithDaemon(sessionId, machineId);
    await t.mutation(api.machines.setMachineAlias, {
      sessionId,
      machineId,
      alias: 'Primary',
    });

    const result = await t.query(api.machines.getUserMachines, { sessionId });

    expect(result.machines).toHaveLength(1);
    expect(result.machines[0]).toEqual({
      machineId,
      hostname: 'test-host',
      alias: 'Primary',
      os: 'darwin',
      registeredAt: expect.any(Number),
    });
  });

  test('another user session sees an empty machine list', async () => {
    const { sessionId: ownerSessionId } = await createTestSession('test-user-machines-owner');
    const { sessionId: otherSessionId } = await createTestSession('test-user-machines-other');

    await registerMachineWithDaemon(ownerSessionId, 'machine-user-machines-owned');

    const result = await t.query(api.machines.getUserMachines, { sessionId: otherSessionId });

    expect(result.machines).toEqual([]);
  });
});
