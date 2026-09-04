import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import {
  buildMachineOperationalSignalKey,
  writeMachineOperationalSignal,
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

describe('writeMachineOperationalSignal', () => {
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
      await writeMachineOperationalSignal(ctx, {
        machineId,
        chatroomId,
        role: 'Builder',
        revisionKey: 'revision-1',
        projectedAt: 100,
      });
      await writeMachineOperationalSignal(ctx, {
        machineId,
        chatroomId,
        role: 'Builder',
        revisionKey: 'revision-older',
        projectedAt: 99,
      });
      await writeMachineOperationalSignal(ctx, {
        machineId,
        chatroomId,
        role: 'Builder',
        revisionKey: 'revision-2',
        projectedAt: 101,
      });
    });

    const signals = await t.run((ctx) =>
      ctx.db
        .query('chatroom_machineOperationalSignals')
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
});
