import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { listOperationalStatusForMachineSignalRange } from './list-operational-status-for-machine-signal-range';
import { api } from '../../../../convex/_generated/api';
import { t } from '../../../../test.setup';

describe('listOperationalStatusForMachineSignalRange', () => {
  test('hydrates current rows and returns removed signals separately', async () => {
    const sessionId = `operational-hydrate-${Math.random()}` as SessionId;
    await t.mutation(api.auth.loginAnon, { sessionId });
    const chatroomId = await t.mutation(api.chatrooms.create, {
      sessionId,
      teamId: 'duo',
      teamName: 'Duo',
      teamRoles: ['planner', 'builder'],
      teamEntryPoint: 'planner',
    });
    const machineId = 'operational-hydrate-machine';
    const firstKey = `0000000000000100:${chatroomId}:builder`;
    const removedKey = `0000000000000101:${chatroomId}:planner`;

    await t.run(async (ctx) => {
      await ctx.db.insert('chatroom_agentRoleOperationalStatus', {
        chatroomId,
        role: 'builder',
        teamId: 'duo',
        machineId,
        operationalState: 'running',
        isAlive: true,
        isRunning: true,
        daemonConnected: true,
        projectedAt: 100,
        revisionKey: 'revision-1',
      });
      await ctx.db.insert('chatroom_machineOperationalSignals', {
        machineId,
        chatroomId,
        role: 'builder',
        revisionKey: 'revision-1',
        signalKey: firstKey,
        projectedAt: 100,
      });
      await ctx.db.insert('chatroom_machineOperationalSignals', {
        machineId,
        chatroomId,
        role: 'planner',
        revisionKey: 'revision-removed',
        signalKey: removedKey,
        projectedAt: 101,
        removed: true,
      });
    });

    const result = await t.run((ctx) =>
      listOperationalStatusForMachineSignalRange(ctx, {
        machineId,
        userId: 'unused',
        afterSignalKey: '',
        throughSignalKey: removedKey,
        limit: 10,
      })
    );

    expect(result.rows).toEqual([
      {
        chatroomId,
        role: 'builder',
        operationalState: 'running',
        isAlive: true,
        isRunning: true,
        daemonConnected: true,
        revisionKey: 'revision-1',
      },
    ]);
    expect(result.removed).toEqual([{ chatroomId, role: 'planner' }]);
    expect(result.nextSignalKey).toBe(removedKey);
    expect(result.hasMore).toBe(false);
  });
});
