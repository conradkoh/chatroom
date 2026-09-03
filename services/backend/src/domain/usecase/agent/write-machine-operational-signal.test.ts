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
  test('creates a head and advances it only for newer signal keys', async () => {
    const sessionId = 'operational-signal-head' as SessionId;
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

    const result = await t.run(async (ctx) => {
      const signals = await ctx.db
        .query('chatroom_machineOperationalSignals')
        .withIndex('by_machineId_signalKey', (q) => q.eq('machineId', machineId))
        .collect();
      const head = await ctx.db
        .query('chatroom_machineOperationalSignalHeads')
        .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
        .first();
      return { signals, head };
    });

    expect(result.signals).toHaveLength(3);
    expect(result.head?.previousSignalKey).toBe('0000000000000100:' + chatroomId + ':builder');
    expect(result.head?.latestSignal.signalKey).toBe('0000000000000101:' + chatroomId + ':builder');
    expect(result.head?.latestSignal.revisionKey).toBe('revision-2');
  });
});
