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
      chatroomId,
      afterKey: '',
    });
    expect(subscription).not.toBeNull();
    expect(subscription!.items.some((item) => item.chatroomId === chatroomId)).toBe(true);
    expect(subscription!.items.every((item) => item.chatroomId === chatroomId)).toBe(true);

    const item = [...subscription!.items]
      .reverse()
      .find((entry) => entry.chatroomId === chatroomId)!;
    const hydrated = await t.query(api.machines.listOperationalStatusForMachineSignalRange, {
      sessionId,
      machineId,
      chatroomId,
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
      chatroomId,
      throughSignalKey: subscription!.highKey,
    });
    const idle = await t.query(api.machines.subscribeMachineOperationalSignalsSince, {
      sessionId,
      machineId,
      chatroomId,
      afterKey: subscription!.highKey,
    });
    expect(idle).toBeNull();
    const remaining = await t.run((ctx) =>
      ctx.db
        .query('chatroom_machineOperationalSignals')
        .withIndex('by_machineId_chatroomId_signalKey', (q) =>
          q.eq('machineId', machineId).eq('chatroomId', chatroomId)
        )
        .collect()
    );
    expect(remaining).toHaveLength(0);
  });

  test('isolates signals, hydration, and acks per chatroom on one machine', async () => {
    const { sessionId } = await createTestSession('machine-operational-signals-isolation');
    const machineId = 'machine-operational-signals-isolation';
    await registerMachineWithDaemon(sessionId, machineId);
    const chatroomA = await t.mutation(api.chatrooms.create, {
      sessionId,
      teamId: 'duo',
      teamName: 'Duo',
      teamRoles: ['planner', 'builder'],
      teamEntryPoint: 'planner',
    });
    const chatroomB = await t.mutation(api.chatrooms.create, {
      sessionId,
      teamId: 'duo',
      teamName: 'Duo',
      teamRoles: ['planner', 'builder'],
      teamEntryPoint: 'planner',
    });
    await setupRemoteAgentConfig(sessionId, chatroomA, machineId, 'builder');
    await setupRemoteAgentConfig(sessionId, chatroomB, machineId, 'builder');
    await updateSpawnedAgentInTest(sessionId, machineId, chatroomA, 'builder', 62003);
    await updateSpawnedAgentInTest(sessionId, machineId, chatroomB, 'builder', 62004);

    const subscriptionA = await t.query(api.machines.subscribeMachineOperationalSignalsSince, {
      sessionId,
      machineId,
      chatroomId: chatroomA,
      afterKey: '',
    });
    expect(subscriptionA).not.toBeNull();
    expect(subscriptionA!.items.some((item) => item.chatroomId === chatroomA)).toBe(true);
    expect(subscriptionA!.items.every((item) => item.chatroomId === chatroomA)).toBe(true);

    const subscriptionB = await t.query(api.machines.subscribeMachineOperationalSignalsSince, {
      sessionId,
      machineId,
      chatroomId: chatroomB,
      afterKey: '',
    });
    expect(subscriptionB).not.toBeNull();
    expect(subscriptionB!.items.some((item) => item.chatroomId === chatroomB)).toBe(true);
    expect(subscriptionB!.items.every((item) => item.chatroomId === chatroomB)).toBe(true);

    const hydratedA = await t.query(api.machines.listOperationalStatusForMachineSignalRange, {
      sessionId,
      machineId,
      chatroomId: chatroomA,
      afterSignalKey: '',
      throughSignalKey: subscriptionA!.highKey,
      limit: 100,
    });
    expect(hydratedA.rows).toContainEqual(expect.objectContaining({ chatroomId: chatroomA }));
    expect(hydratedA.rows.every((row) => row.chatroomId === chatroomA)).toBe(true);
    expect(hydratedA.removed.every((entry) => entry.chatroomId === chatroomA)).toBe(true);

    await t.mutation(api.machines.ackMachineOperationalSignals, {
      sessionId,
      machineId,
      chatroomId: chatroomA,
      throughSignalKey: subscriptionA!.highKey,
    });

    const roomARemaining = await t.run((ctx) =>
      ctx.db
        .query('chatroom_machineOperationalSignals')
        .withIndex('by_machineId_chatroomId_signalKey', (q) =>
          q.eq('machineId', machineId).eq('chatroomId', chatroomA)
        )
        .collect()
    );
    const roomBRemaining = await t.run((ctx) =>
      ctx.db
        .query('chatroom_machineOperationalSignals')
        .withIndex('by_machineId_chatroomId_signalKey', (q) =>
          q.eq('machineId', machineId).eq('chatroomId', chatroomB)
        )
        .collect()
    );
    expect(roomARemaining).toHaveLength(0);
    expect(roomBRemaining.length).toBeGreaterThan(0);
    expect(roomBRemaining.every((row) => row.chatroomId === chatroomB)).toBe(true);
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
    await setupRemoteAgentConfig(ownerSessionId, chatroomId, machineId, 'builder');
    await updateSpawnedAgentInTest(ownerSessionId, machineId, chatroomId, 'builder', 62002);

    const { sessionId: otherSessionId } = await createTestSession(
      'machine-operational-signals-other'
    );
    await expect(
      t.mutation(api.machines.ackMachineOperationalSignals, {
        sessionId: otherSessionId,
        machineId,
        chatroomId,
        throughSignalKey: 'z',
      })
    ).rejects.toThrow();

    const signals = await t.run((ctx) =>
      ctx.db
        .query('chatroom_machineOperationalSignals')
        .withIndex('by_machineId_chatroomId_signalKey', (q) =>
          q.eq('machineId', machineId).eq('chatroomId', chatroomId)
        )
        .collect()
    );
    expect(signals.length).toBeGreaterThan(0);
  });
});
