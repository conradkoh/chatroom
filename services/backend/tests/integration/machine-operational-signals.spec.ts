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
  test('keeps purpose-specific feeds isolated on the same machine and room', async () => {
    const { sessionId } = await createTestSession('machine-operational-signal-feeds');
    const machineId = 'machine-operational-signal-feeds';
    await registerMachineWithDaemon(sessionId, machineId);
    const chatroomId = await t.mutation(api.chatrooms.create, {
      sessionId,
      teamId: 'duo',
      teamName: 'Duo',
      teamRoles: ['planner', 'builder'],
      teamEntryPoint: 'planner',
    });
    const signalRows = [
      ['chatroom_machineAgentOperationalSignals', 'agent-operational'],
      ['chatroom_machineConnectivitySignals', 'connectivity'],
      ['chatroom_machineAgentStopSignals', 'agent-stop'],
      ['chatroom_machineAgentRemovalSignals', 'agent-removal'],
    ] as const;
    await t.run(async (ctx) => {
      for (const [index, [table, suffix]] of signalRows.entries()) {
        const base = {
          machineId,
          chatroomId,
          role: 'builder',
          revisionKey: suffix,
          signalKey: `000000000000000${index + 1}:${chatroomId}:builder`,
          projectedAt: 100,
        };
        if (table === 'chatroom_machineAgentOperationalSignals')
          await ctx.db.insert(table, { ...base, kind: 'agent-operational' });
        else if (table === 'chatroom_machineConnectivitySignals')
          await ctx.db.insert(table, { ...base, kind: 'connectivity', daemonConnected: true });
        else if (table === 'chatroom_machineAgentStopSignals')
          await ctx.db.insert(table, { ...base, kind: 'agent-stop', stopState: 'pending' });
        else await ctx.db.insert(table, { ...base, kind: 'agent-removal', reason: 'role-removed' });
      }
    });

    const feeds = [
      [
        api.machines.subscribeMachineAgentOperationalSignalsSince,
        api.machines.ackMachineAgentOperationalSignals,
      ],
      [
        api.machines.subscribeMachineConnectivitySignalsSince,
        api.machines.ackMachineConnectivitySignals,
      ],
      [api.machines.subscribeMachineAgentStopSignalsSince, api.machines.ackMachineAgentStopSignals],
      [
        api.machines.subscribeMachineAgentRemovalSignalsSince,
        api.machines.ackMachineAgentRemovalSignals,
      ],
    ] as const;
    const pages = await Promise.all(
      feeds.map(([subscribe]) =>
        t.query(subscribe, { sessionId, machineId, chatroomId, afterKey: '' })
      )
    );
    expect(pages.every((page) => page?.items.length === 1)).toBe(true);

    await t.mutation(feeds[0][1], {
      sessionId,
      machineId,
      chatroomId,
      throughSignalKey: pages[0]!.highKey,
    });
    const remaining = await t.run(async (ctx) =>
      Promise.all(signalRows.map(([table]) => ctx.db.query(table).collect()))
    );
    expect(remaining[0]).toHaveLength(0);
    expect(remaining.slice(1).every((rows) => rows.length === 1)).toBe(true);
  });

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

    const subscription = await t.query(api.machines.subscribeMachineAgentOperationalSignalsSince, {
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
    const hydrated = await t.query(api.machines.listMachineAgentOperationalStatusForSignalRange, {
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

    await t.mutation(api.machines.ackMachineAgentOperationalSignals, {
      sessionId,
      machineId,
      chatroomId,
      throughSignalKey: subscription!.highKey,
    });
    const idle = await t.query(api.machines.subscribeMachineAgentOperationalSignalsSince, {
      sessionId,
      machineId,
      chatroomId,
      afterKey: subscription!.highKey,
    });
    expect(idle).toBeNull();
    const remaining = await t.run((ctx) =>
      ctx.db
        .query('chatroom_machineAgentOperationalSignals')
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

    const subscriptionA = await t.query(api.machines.subscribeMachineAgentOperationalSignalsSince, {
      sessionId,
      machineId,
      chatroomId: chatroomA,
      afterKey: '',
    });
    expect(subscriptionA).not.toBeNull();
    expect(subscriptionA!.items.some((item) => item.chatroomId === chatroomA)).toBe(true);
    expect(subscriptionA!.items.every((item) => item.chatroomId === chatroomA)).toBe(true);

    const subscriptionB = await t.query(api.machines.subscribeMachineAgentOperationalSignalsSince, {
      sessionId,
      machineId,
      chatroomId: chatroomB,
      afterKey: '',
    });
    expect(subscriptionB).not.toBeNull();
    expect(subscriptionB!.items.some((item) => item.chatroomId === chatroomB)).toBe(true);
    expect(subscriptionB!.items.every((item) => item.chatroomId === chatroomB)).toBe(true);

    const hydratedA = await t.query(api.machines.listMachineAgentOperationalStatusForSignalRange, {
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

    await t.mutation(api.machines.ackMachineAgentOperationalSignals, {
      sessionId,
      machineId,
      chatroomId: chatroomA,
      throughSignalKey: subscriptionA!.highKey,
    });

    const roomARemaining = await t.run((ctx) =>
      ctx.db
        .query('chatroom_machineAgentOperationalSignals')
        .withIndex('by_machineId_chatroomId_signalKey', (q) =>
          q.eq('machineId', machineId).eq('chatroomId', chatroomA)
        )
        .collect()
    );
    const roomBRemaining = await t.run((ctx) =>
      ctx.db
        .query('chatroom_machineAgentOperationalSignals')
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
      t.mutation(api.machines.ackMachineAgentOperationalSignals, {
        sessionId: otherSessionId,
        machineId,
        chatroomId,
        throughSignalKey: 'z',
      })
    ).rejects.toThrow();

    const signals = await t.run((ctx) =>
      ctx.db
        .query('chatroom_machineAgentOperationalSignals')
        .withIndex('by_machineId_chatroomId_signalKey', (q) =>
          q.eq('machineId', machineId).eq('chatroomId', chatroomId)
        )
        .collect()
    );
    expect(signals.length).toBeGreaterThan(0);
  });
});
