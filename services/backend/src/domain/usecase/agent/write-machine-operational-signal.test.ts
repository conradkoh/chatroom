import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import {
  buildMachineOperationalSignalKey,
  writeMachineAgentRemovalSignal,
  writeMachineAgentOperationalSignal,
  writeMachineAgentStopSignal,
  writeMachineConnectivitySignal,
} from './write-machine-operational-signal';
import { api } from '../../../../convex/_generated/api';
import { t } from '../../../../test.setup';

describe('buildMachineOperationalSignalKey', () => {
  test('orders by timestamp, then chatroom and role', () => {
    const first = buildMachineOperationalSignalKey(12, 'room-a' as never, 'Builder');
    const second = buildMachineOperationalSignalKey(13, 'room-a' as never, 'planner');
    expect(first).toBe('0000000000000012:room-a:builder');
    expect(first < second).toBe(true);
  });
});

describe('writeMachineAgentOperationalSignal', () => {
  test('appends signals and does not create an operational head', async () => {
    const sessionId = 'operational-signal-append' as SessionId;
    await t.mutation(api.auth.loginAnon, { sessionId });
    const chatroomId = await t.mutation(api.chatrooms.create, {
      sessionId,
      teamId: 'duo',
      teamName: 'Duo',
      teamRoles: ['planner', 'builder'],
      teamEntryPoint: 'planner',
    });
    const machineId = 'operational-signal-machine';

    await t.run(async (ctx) => {
      await writeMachineAgentOperationalSignal(ctx, {
        machineId,
        chatroomId,
        role: 'Builder',
        revisionKey: 'revision-1',
        projectedAt: 100,
      });
      await writeMachineAgentOperationalSignal(ctx, {
        machineId,
        chatroomId,
        role: 'Builder',
        revisionKey: 'revision-older',
        projectedAt: 99,
      });
      await writeMachineAgentOperationalSignal(ctx, {
        machineId,
        chatroomId,
        role: 'Builder',
        revisionKey: 'revision-2',
        projectedAt: 101,
      });
    });

    const signals = await t.run((ctx) =>
      ctx.db
        .query('chatroom_machineAgentOperationalSignals')
        .withIndex('by_machineId_chatroomId_signalKey', (q) =>
          q.eq('machineId', machineId).eq('chatroomId', chatroomId)
        )
        .order('asc')
        .collect()
    );

    expect(signals).toHaveLength(3);
    expect(signals.map((row) => row.signalKey)).toEqual([
      '0000000000000099:' + chatroomId + ':builder',
      '0000000000000100:' + chatroomId + ':builder',
      '0000000000000101:' + chatroomId + ':builder',
    ]);
    expect(signals.map((row) => row.revisionKey)).toEqual([
      'revision-older',
      'revision-1',
      'revision-2',
    ]);
  });

  test('writes each purpose to its own signal table', async () => {
    const sessionId = 'operational-signal-purpose-tables' as SessionId;
    await t.mutation(api.auth.loginAnon, { sessionId });
    const chatroomId = await t.mutation(api.chatrooms.create, {
      sessionId,
      teamId: 'duo',
      teamName: 'Duo',
      teamRoles: ['planner', 'builder'],
      teamEntryPoint: 'planner',
    });
    const input = {
      machineId: `operational-signal-purpose-machine-${Math.random()}`,
      chatroomId,
      role: 'builder',
      revisionKey: 'revision-purpose',
      projectedAt: 200,
    };

    await t.run(async (ctx) => {
      await writeMachineAgentOperationalSignal(ctx, input);
      await writeMachineConnectivitySignal(ctx, input);
      await writeMachineAgentStopSignal(ctx, input);
      await writeMachineAgentRemovalSignal(ctx, input);
    });

    const counts = await t.run(async (ctx) =>
      Promise.all([
        ctx.db
          .query('chatroom_machineAgentOperationalSignals')
          .withIndex('by_machineId_chatroomId_signalKey', (q) =>
            q.eq('machineId', input.machineId).eq('chatroomId', chatroomId)
          )
          .collect(),
        ctx.db
          .query('chatroom_machineConnectivitySignals')
          .withIndex('by_machineId_chatroomId_signalKey', (q) =>
            q.eq('machineId', input.machineId).eq('chatroomId', chatroomId)
          )
          .collect(),
        ctx.db
          .query('chatroom_machineAgentStopSignals')
          .withIndex('by_machineId_chatroomId_signalKey', (q) =>
            q.eq('machineId', input.machineId).eq('chatroomId', chatroomId)
          )
          .collect(),
        ctx.db
          .query('chatroom_machineAgentRemovalSignals')
          .withIndex('by_machineId_chatroomId_signalKey', (q) =>
            q.eq('machineId', input.machineId).eq('chatroomId', chatroomId)
          )
          .collect(),
      ])
    );
    expect(counts.map((rows) => rows.length)).toEqual([1, 1, 1, 1]);
  });
});
