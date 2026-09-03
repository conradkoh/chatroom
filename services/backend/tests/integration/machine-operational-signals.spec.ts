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
    await setupRemoteAgentConfig(sessionId, chatroomId, machineId, 'planner');
    await updateSpawnedAgentInTest(sessionId, machineId, chatroomId, 'planner', 62001);

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

    await t.mutation(api.machines.ackMachineOperationalSignals, {
      sessionId,
      machineId,
      throughSignalKey: subscription!.highKey,
    });
    const idle = await t.query(api.machines.subscribeMachineOperationalSignalsSince, {
      sessionId,
      machineId,
      afterKey: subscription!.highKey,
    });
    expect(idle).toBeNull();
    const remaining = await t.run((ctx) =>
      ctx.db
        .query('chatroom_machineOperationalSignals')
        .withIndex('by_machineId_signalKey', (q) => q.eq('machineId', machineId))
        .collect()
    );
    expect(remaining).toHaveLength(0);
  });

  test('rejects ack from non-owner and preserves signal rows', async () => {
    const { sessionId: ownerSessionId } = await createTestSession(
      'machine-operational-signals-owner'
    );
    const machineId = 'machine-operational-signals-owner';
    await registerMachineWithDaemon(ownerSessionId, machineId);
    const chatroomId = await t.mutation(api.chatrooms.create, {
      sessionId: ownerSessionId,
      teamId: 'duo',
      teamName: 'Duo',
      teamRoles: ['planner', 'builder'],
      teamEntryPoint: 'planner',
    });
    await setupRemoteAgentConfig(ownerSessionId, chatroomId, machineId, 'planner');
    await updateSpawnedAgentInTest(ownerSessionId, machineId, chatroomId, 'planner', 62002);

    const { sessionId: otherSessionId } = await createTestSession(
      'machine-operational-signals-other'
    );
    await expect(
      t.mutation(api.machines.ackMachineOperationalSignals, {
        sessionId: otherSessionId,
        machineId,
        throughSignalKey: 'z',
      })
    ).rejects.toThrow();

    const signals = await t.run((ctx) =>
      ctx.db
        .query('chatroom_machineOperationalSignals')
        .withIndex('by_machineId_signalKey', (q) => q.eq('machineId', machineId))
        .collect()
    );
    expect(signals.length).toBeGreaterThan(0);
  });
});
