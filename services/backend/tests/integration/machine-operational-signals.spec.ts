import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import { t } from '../../test.setup';
import {
  createTestSession,
  registerMachineWithDaemon,
  setupRemoteAgentConfig,
  updateSpawnedAgentInTest,
} from '../helpers/integration';

describe('machine operational signals', () => {
  test('projects a row into signal, subscription, and hydration pages', async () => {
    const { sessionId } = await createTestSession('machine-operational-signals');
    const machineId = 'machine-operational-signals';
    await registerMachineWithDaemon(sessionId, machineId);
    const chatroomId = await t.mutation(api.chatrooms.create, {
      sessionId,
      teamId: 'duo',
      teamName: 'Duo',
      teamRoles: ['planner', 'builder'],
      teamEntryPoint: 'planner',
    });
    await setupRemoteAgentConfig(sessionId, chatroomId, machineId, 'builder');
    await updateSpawnedAgentInTest(sessionId, machineId, chatroomId, 'builder', 62001);

    const subscription = await t.query(api.machines.subscribeMachineOperationalSignalsSince, {
      sessionId,
      machineId,
      afterKey: '',
    });
    expect(subscription).not.toBeNull();
    expect(subscription!.items.some((item) => item.chatroomId === chatroomId)).toBe(true);

    const item = [...subscription!.items]
      .reverse()
      .find((entry) => entry.chatroomId === chatroomId)!;
    const hydrated = await t.query(api.machines.listOperationalStatusForMachineSignalRange, {
      sessionId,
      machineId,
      afterSignalKey: '',
      throughSignalKey: subscription!.highKey,
      limit: 100,
    });
    expect(hydrated.rows).toContainEqual(
      expect.objectContaining({
        chatroomId,
        role: item.role,
        revisionKey: item.revisionKey,
      })
    );
  });
});
