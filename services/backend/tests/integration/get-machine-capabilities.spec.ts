/**
 * getMachineCapabilities Integration Tests
 *
 * Tests the per-machine daemon capability read model query.
 */

import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import { t } from '../../test.setup';
import { createTestSession } from '../helpers/integration';

describe('getMachineCapabilities', () => {
  test('returns capabilities for an owned machine', async () => {
    const { sessionId } = await createTestSession('test-machine-capabilities');
    const machineId = 'machine-capabilities-owned';
    const harnessVersions = { opencode: { version: '1.2.3', major: 1 } };

    await t.mutation(api.machines.register, {
      sessionId,
      machineId,
      hostname: 'test-host',
      os: 'darwin',
      availableHarnesses: ['opencode'],
      harnessVersions,
      availableModels: { opencode: ['provider/model'] },
    });

    const result = await t.query(api.machines.getMachineCapabilities, {
      sessionId,
      machineId,
    });

    expect(result).toEqual({
      availableHarnesses: ['opencode'],
      harnessVersions,
    });
  });

  test('returns empty defaults for unknown and foreign machines', async () => {
    const { sessionId: ownerSessionId } = await createTestSession(
      'test-machine-capabilities-owner'
    );
    const { sessionId: otherSessionId } = await createTestSession(
      'test-machine-capabilities-other'
    );
    const machineId = 'machine-capabilities-foreign';

    await t.mutation(api.machines.register, {
      sessionId: ownerSessionId,
      machineId,
      hostname: 'test-host',
      os: 'darwin',
      availableHarnesses: ['opencode'],
    });

    const foreignResult = await t.query(api.machines.getMachineCapabilities, {
      sessionId: otherSessionId,
      machineId,
    });
    const unknownResult = await t.query(api.machines.getMachineCapabilities, {
      sessionId: otherSessionId,
      machineId: 'machine-capabilities-unknown',
    });

    expect(foreignResult).toEqual({ availableHarnesses: [], harnessVersions: {} });
    expect(unknownResult).toEqual({ availableHarnesses: [], harnessVersions: {} });
  });
});
