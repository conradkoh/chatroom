import { describe, expect, test } from 'vitest';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { buildTeamRoleKey } from '../../convex/utils/teamRoleKey';
import { getAgentViewStatus } from '../../src/domain/usecase/chatroom/get-agent-view-status';
import { markAgentViewHasHistory } from '../../src/domain/usecase/chatroom/project-agent-view-metadata';
import { t } from '../../test.setup';
import { createDuoTeamChatroom, createTestSession, registerMachineWithDaemon, setupRemoteAgentConfig } from '../helpers/integration';

function createThreeRoleChatroom(sessionId: string) {
  return t.mutation(api.chatrooms.create, { sessionId: sessionId as any, teamId: 'custom', teamName: 'Custom Three-Role Team', teamRoles: ['planner', 'builder', 'architect'], teamEntryPoint: 'planner' });
}

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

describe('getAgentViewStatus — fresh team', () => {
  test('returns all team roles stopped', async () => {
    const { sessionId } = await createTestSession('view-fresh-3role');
    const result = await query(await createThreeRoleChatroom(sessionId));
    expect(result!.teamRoles).toEqual(['planner', 'builder', 'architect']);
    expect(result!.agents).toHaveLength(3);
    expect(result!.agents.every((a) => a.state === 'stopped')).toBe(true);
  });
});

describe('getAgentViewStatus — running and stopped', () => {
  test('returns running state with machine name', async () => {
    const { sessionId } = await createTestSession('view-running-name'); const machineId = 'view-running-name-machine';
    await registerMachineWithDaemon(sessionId as any, machineId); const room = await createDuoTeamChatroom(sessionId as any);
    await setupRemoteAgentConfig(sessionId as any, room, machineId, 'builder');
    await t.mutation(api.machines.updateSpawnedAgent, { sessionId: sessionId as any, machineId, chatroomId: room, role: 'builder', pid: 12345 });
    const builder = (await query(room))!.agents.find((a) => a.role === 'builder'); expect(builder?.state).toBe('running'); expect(builder?.machineName).toBe('test-host');
  });
  test('returns stopped after stop command', async () => {
    const { sessionId } = await createTestSession('view-stopped'); const machineId = 'view-stopped-machine';
    await registerMachineWithDaemon(sessionId as any, machineId); const room = await createDuoTeamChatroom(sessionId as any);
    await setupRemoteAgentConfig(sessionId as any, room, machineId, 'builder');
    await t.mutation(api.machines.sendCommand, { sessionId: sessionId as any, machineId, type: 'stop-agent', payload: { chatroomId: room, role: 'builder' } });
    expect((await query(room))!.agents.find((a) => a.role === 'builder')?.state).toBe('stopped');
  });
});

describe('getAgentViewStatus — daemon disconnected', () => {
  test('returns stopped with PID when disconnected', async () => {
    const { sessionId } = await createTestSession('view-disconn-pid'); const machineId = 'view-disconn-pid-machine'; await registerMachineWithDaemon(sessionId as any, machineId); const room = await createDuoTeamChatroom(sessionId as any); await setupRemoteAgentConfig(sessionId as any, room, machineId, 'builder');
    await t.mutation(api.machines.updateSpawnedAgent, { sessionId: sessionId as any, machineId, chatroomId: room, role: 'builder', pid: 88888 }); await t.mutation(api.machines.updateDaemonStatus, { sessionId: sessionId as any, machineId, connected: false });
    expect((await query(room))!.agents.find((a) => a.role === 'builder')?.state).toBe('stopped');
  });
  test('returns stopped without PID when disconnected', async () => {
    const { sessionId } = await createTestSession('view-disconn-none'); const machineId = 'view-disconn-none-machine'; await registerMachineWithDaemon(sessionId as any, machineId); const room = await createDuoTeamChatroom(sessionId as any); await setupRemoteAgentConfig(sessionId as any, room, machineId, 'builder'); await t.mutation(api.machines.updateDaemonStatus, { sessionId: sessionId as any, machineId, connected: false });
    expect((await query(room))!.agents.find((a) => a.role === 'builder')?.state).toBe('stopped');
  });
});

describe('getAgentViewStatus — daemon restart cleanup', () => {
  test('returns stopped after clearing PIDs', async () => {
    const { sessionId } = await createTestSession('view-restart'); const machineId = 'view-restart-machine'; await registerMachineWithDaemon(sessionId as any, machineId); const room = await createDuoTeamChatroom(sessionId as any); await setupRemoteAgentConfig(sessionId as any, room, machineId, 'builder'); await t.mutation(api.machines.updateSpawnedAgent, { sessionId: sessionId as any, machineId, chatroomId: room, role: 'builder', pid: 12345 }); await t.mutation(api.machines.clearAllSpawnedPids, { sessionId: sessionId as any, machineId });
    expect((await query(room))!.agents.find((a) => a.role === 'builder')?.state).toBe('stopped');
  });
});

describe('getAgentViewStatus — circuit breaker', () => {
  test('returns circuit_open when tripped', async () => {
    const { sessionId } = await createTestSession('view-circuit'); const machineId = 'view-circuit-machine'; await registerMachineWithDaemon(sessionId as any, machineId); const room = await createDuoTeamChatroom(sessionId as any); await setupRemoteAgentConfig(sessionId as any, room, machineId, 'builder');
    await t.run(async (ctx) => { const config = await ctx.db.query('chatroom_teamAgentConfigs').withIndex('by_teamRoleKey', (q) => q.eq('teamRoleKey', buildTeamRoleKey(room, 'duo', 'builder'))).first(); if (config) await ctx.db.patch(config._id, { circuitState: 'open', circuitOpenedAt: Date.now() }); });
    await t.mutation(api.machines.backfillAgentOperationalStatusForMachine, { sessionId: sessionId as any, machineId });
    expect((await query(room))!.agents.find((a) => a.role === 'builder')?.state).toBe('circuit_open');
  });
});

describe('getAgentViewStatus — stale roles', () => {
  test('excludes roles removed from current team', async () => {
    const { sessionId } = await createTestSession('view-stale'); const machineId = 'view-stale-machine'; await registerMachineWithDaemon(sessionId as any, machineId); const room = await createThreeRoleChatroom(sessionId); for (const role of ['planner', 'builder', 'architect']) await setupRemoteAgentConfig(sessionId as any, room, machineId, role);
    await t.mutation(api.chatrooms.updateTeam, { sessionId: sessionId as any, chatroomId: room, teamId: 'duo', teamName: 'Duo Team', teamRoles: ['planner', 'builder'], teamEntryPoint: 'planner' });
    const result = await query(room); expect(result!.agents).toHaveLength(2); expect(result!.agents.map((a) => a.role)).toEqual(['planner', 'builder']);
  });
});

describe('getAgentViewStatus — projection fast path', () => {
  test('hasHistory stays false until the projection marker is written', async () => {
    const { sessionId } = await createTestSession('view-history-projection');
    const room = await createDuoTeamChatroom(sessionId as any);
    expect((await query(room))?.hasHistory).toBe(false);
    await t.run(async (ctx) => {
      await ctx.db.insert('chatroom_messages', { chatroomId: room, senderRole: 'assistant', content: 'progress', type: 'progress' });
    });
    expect((await query(room))?.hasHistory).toBe(false);
    await t.run((ctx) => markAgentViewHasHistory(ctx, room));
    expect((await query(room))?.hasHistory).toBe(true);
  });
});

describe('getAgentViewStatus — decoy isolation', () => {
  test('resolves the assigned machine name with unrelated machines present', async () => {
    const { sessionId } = await createTestSession('view-decoy-isolation');
    const target = 'view-decoy-target';
    await registerMachineWithDaemon(sessionId as any, target);
    const room = await createDuoTeamChatroom(sessionId as any);
    await setupRemoteAgentConfig(sessionId as any, room, target, 'builder');
    for (let i = 0; i < 5; i++) await registerMachineWithDaemon(sessionId as any, `view-decoy-${i}`);
    expect((await query(room))?.agents.find((a) => a.role === 'builder')?.machineName).toBe('test-host');
  });
});
