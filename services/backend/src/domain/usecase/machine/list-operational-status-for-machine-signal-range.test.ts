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
    const otherChatroomId = await t.mutation(api.chatrooms.create, {
      sessionId,
      teamId: 'duo',
      teamName: 'Duo',
      teamRoles: ['planner', 'builder'],
      teamEntryPoint: 'planner',
    });
    const machineId = 'operational-hydrate-machine';
    const firstKey = `0000000000000100:${chatroomId}:builder`;
    const removedKey = `0000000000000101:${chatroomId}:planner`;
    const otherRoomKey = `0000000000000102:${otherChatroomId}:builder`;

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
      await ctx.db.insert('chatroom_agentRoleOperationalStatus', {
        chatroomId: otherChatroomId,
        role: 'builder',
        teamId: 'duo',
        machineId,
        operationalState: 'running',
        isAlive: true,
        isRunning: true,
        daemonConnected: true,
        projectedAt: 102,
        revisionKey: 'revision-other',
      });
      await ctx.db.insert('chatroom_machineAgentOperationalSignals', {
        machineId,
        chatroomId,
        kind: 'agent-operational',
        role: 'builder',
        revisionKey: 'revision-1',
        signalKey: firstKey,
        projectedAt: 100,
      });
      await ctx.db.insert('chatroom_machineAgentRemovalSignals', {
        machineId,
        chatroomId,
        kind: 'agent-removal',
        role: 'planner',
        reason: 'role-removed',
        revisionKey: 'revision-removed',
        signalKey: removedKey,
        projectedAt: 101,
      });
      await ctx.db.insert('chatroom_machineAgentOperationalSignals', {
        machineId,
        chatroomId: otherChatroomId,
        kind: 'agent-operational',
        role: 'builder',
        revisionKey: 'revision-other',
        signalKey: otherRoomKey,
        projectedAt: 102,
      });
    });

    const result = await t.run((ctx) =>
      listOperationalStatusForMachineSignalRange(ctx, {
        machineId,
        chatroomId: String(chatroomId),
        userId: 'unused',
        afterSignalKey: '',
        throughSignalKey: firstKey,
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
    expect(result.removed).toEqual([]);
    expect(result.nextSignalKey).toBe(firstKey);
    expect(result.hasMore).toBe(false);

    const removedResult = await t.run((ctx) =>
      listOperationalStatusForMachineSignalRange(
        ctx,
        {
          machineId,
          chatroomId: String(chatroomId),
          userId: 'unused',
          afterSignalKey: '',
          throughSignalKey: removedKey,
          limit: 10,
        },
        'chatroom_machineAgentRemovalSignals'
      )
    );
    expect(removedResult.rows).toEqual([]);
    expect(removedResult.removed).toEqual([{ chatroomId, role: 'planner' }]);
    expect(removedResult.nextSignalKey).toBe(removedKey);

    const otherRoom = await t.run((ctx) =>
      listOperationalStatusForMachineSignalRange(ctx, {
        machineId,
        chatroomId: String(otherChatroomId),
        userId: 'unused',
        afterSignalKey: '',
        throughSignalKey: otherRoomKey,
        limit: 10,
      })
    );
    expect(otherRoom.rows).toEqual([
      {
        chatroomId: otherChatroomId,
        role: 'builder',
        operationalState: 'running',
        isAlive: true,
        isRunning: true,
        daemonConnected: true,
        revisionKey: 'revision-other',
      },
    ]);
    expect(otherRoom.removed).toEqual([]);
  });
});
