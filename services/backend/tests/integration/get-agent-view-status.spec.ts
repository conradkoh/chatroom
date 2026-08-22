import { describe, expect, test } from 'vitest';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { getAgentViewStatus } from '../../src/domain/usecase/chatroom/get-agent-view-status';
import { t } from '../../test.setup';
import { createDuoTeamChatroom, createTestSession, registerMachineWithDaemon, setupRemoteAgentConfig } from '../helpers/integration';

async function query(chatroomId: Id<'chatroom_rooms'>) {
  const ownerId = await t.run(async (ctx) => (await ctx.db.get('chatroom_rooms', chatroomId))!.ownerId);
  return t.run((ctx) => getAgentViewStatus(ctx, { chatroomId, userId: ownerId }));
}

describe('getAgentViewStatus', () => {
  test('returns all roles stopped for a fresh team', async () => {
    const { sessionId } = await createTestSession('view-fresh');
    const room = await createDuoTeamChatroom(sessionId as any);
    const result = await query(room);
    expect(result?.agents.map((a) => a.state)).toEqual(['stopped', 'stopped']);
  });

  test('returns running from the projection', async () => {
    const { sessionId } = await createTestSession('view-running');
    const machineId = 'view-running-machine';
    await registerMachineWithDaemon(sessionId as any, machineId);
    const room = await createDuoTeamChatroom(sessionId as any);
    await setupRemoteAgentConfig(sessionId as any, room, machineId, 'builder');
    await t.mutation(api.machines.updateSpawnedAgent, { sessionId: sessionId as any, machineId, chatroomId: room, role: 'builder', pid: 123 });
    expect((await query(room))?.agents.find((a) => a.role === 'builder')?.state).toBe('running');
  });

  test('returns starting from an in-flight participant status', async () => {
    const { sessionId } = await createTestSession('view-starting');
    const machineId = 'view-starting-machine';
    await registerMachineWithDaemon(sessionId as any, machineId);
    const room = await createDuoTeamChatroom(sessionId as any);
    await setupRemoteAgentConfig(sessionId as any, room, machineId, 'builder');
    await t.run((ctx) => ctx.db.insert('chatroom_participants', { chatroomId: room, role: 'builder', agentType: 'remote', lastStatus: 'agent.requestStart', lastDesiredState: 'running' }));
    expect((await query(room))?.agents.find((a) => a.role === 'builder')?.state).toBe('starting');
  });

  test('rejects a non-owner', async () => {
    const first = await createTestSession('view-owner');
    const room = await createDuoTeamChatroom(first.sessionId as any);
    const other = await createTestSession('view-other');
    const otherUser = await t.run(async (ctx) => (await ctx.db.query('users').filter((q) => q.eq(q.field('email'), 'view-other@example.com')).first())?._id);
    expect(await t.run((ctx) => getAgentViewStatus(ctx, { chatroomId: room, userId: otherUser! }))).toBeNull();
  });
});
