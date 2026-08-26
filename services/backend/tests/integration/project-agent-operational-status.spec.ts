import { describe, expect, test } from 'vitest';
import { api } from '../../convex/_generated/api';
import { t } from '../../test.setup';
import { buildTeamRoleKey } from '../../convex/utils/teamRoleKey';
import {
  createDuoTeamChatroom,
  createTestSession,
  registerMachineWithDaemon,
  setupRemoteAgentConfig,
} from '../helpers/integration';

async function projectionFor(chatroomId: any, role = 'builder') {
  return t.run(async (ctx) => ({
    role: await ctx.db
      .query('chatroom_agentRoleOperationalStatus')
      .withIndex('by_chatroom_role', (q) => q.eq('chatroomId', chatroomId).eq('role', role))
      .first(),
    summary: await ctx.db
      .query('chatroom_agentOperationalSummary')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
      .first(),
  }));
}

async function configIdFor(chatroomId: any) {
  return t.run(async (ctx) => {
    const room = await ctx.db.get(chatroomId);
    const config = await ctx.db
      .query('chatroom_teamAgentConfigs')
      .withIndex('by_teamRoleKey', (q) =>
        q.eq('teamRoleKey', buildTeamRoleKey(chatroomId, room!.teamId!, 'builder'))
      )
      .first();
    return config!._id;
  });
}

describe('agent operational status projection', () => {
  test('projects an armed ephemeral enhancer with no PID as idle and accepting tasks', async () => {
    const { sessionId } = await createTestSession('operational-enhancer-idle');
    const machineId = 'operational-machine-enhancer';
    await registerMachineWithDaemon(sessionId as any, machineId);
    const chatroomId = await createDuoTeamChatroom(sessionId as any);
    await t.run(async (ctx) => {
      const room = await ctx.db.get(chatroomId);
      await ctx.db.patch(chatroomId, { teamRoles: ['planner', 'enhancer', 'builder'] });
      await ctx.db.insert('chatroom_teamAgentConfigs', {
        teamRoleKey: buildTeamRoleKey(chatroomId, room!.teamId!, 'enhancer'), chatroomId, role: 'enhancer', type: 'remote', machineId,
        agentHarness: 'opencode', model: 'test', workingDir: '/workspace', enabled: true, desiredState: 'running', lifecycleRevision: 0, createdAt: Date.now(), updatedAt: Date.now(),
      });
    });
    await t.mutation(api.machines.backfillAgentOperationalStatusForMachine, { sessionId: sessionId as any, machineId });
    const projection = await projectionFor(chatroomId, 'enhancer');
    expect(projection.role?.acceptsTasks).toBe(true);
    expect(projection.role?.viewState).toBe('idle');
    expect(projection.role?.isAlive).toBe(false);
  });

  test('backfill projects a running config with no PID as starting', async () => {
    const { sessionId } = await createTestSession('operational-starting');
    const machineId = 'operational-machine-starting';
    await registerMachineWithDaemon(sessionId as any, machineId);
    const chatroomId = await createDuoTeamChatroom(sessionId as any);
    await setupRemoteAgentConfig(sessionId as any, chatroomId, machineId, 'builder');

    await t.mutation(api.machines.backfillAgentOperationalStatusForMachine, {
      sessionId: sessionId as any,
      machineId,
    });
    const projection = await projectionFor(chatroomId);
    expect(projection.role?.operationalState).toBe('starting');
    expect(projection.role?.isAlive).toBe(false);
    expect(projection.summary?.agentStatus).toBe('stopped');
  });

  test('exiting a spawned agent projects stopped', async () => {
    const { sessionId } = await createTestSession('operational-stopped');
    const machineId = 'operational-machine-stopped';
    await registerMachineWithDaemon(sessionId as any, machineId);
    const chatroomId = await createDuoTeamChatroom(sessionId as any);
    await setupRemoteAgentConfig(sessionId as any, chatroomId, machineId, 'builder');
    await t.mutation(api.machines.projectAgentLifecycleFact, {
      sessionId: sessionId as any,
      machineId,
      fact: {
        kind: 'spawned',
        chatroomId,
        role: 'builder',
        pid: 51001,
        revisionKey: 'operational:spawn',
        emittedAt: Date.now(),
      },
    });
    await t.mutation(api.machines.projectAgentLifecycleFact, {
      sessionId: sessionId as any,
      machineId,
      fact: {
        kind: 'exited',
        chatroomId,
        role: 'builder',
        pid: 51001,
        revisionKey: 'operational:exit',
        emittedAt: Date.now(),
      },
    });
    await t.run(async (ctx) => {
      const room = await ctx.db.get(chatroomId);
      const config = await ctx.db
        .query('chatroom_teamAgentConfigs')
        .withIndex('by_teamRoleKey', (q) =>
          q.eq('teamRoleKey', buildTeamRoleKey(chatroomId, room!.teamId!, 'builder'))
        )
        .first();
      if (config)
        await ctx.db.patch('chatroom_teamAgentConfigs', config._id, { desiredState: 'stopped' });
    });
    await t.mutation(api.machines.backfillAgentOperationalStatusForMachine, {
      sessionId: sessionId as any,
      machineId,
    });
    const projection = await projectionFor(chatroomId);
    expect(projection.role?.operationalState).toBe('stopped');
    expect(projection.role?.isAlive).toBe(false);
  });

  test('circuit open projects circuit_open', async () => {
    const { sessionId } = await createTestSession('operational-circuit');
    const machineId = 'operational-machine-circuit';
    await registerMachineWithDaemon(sessionId as any, machineId);
    const chatroomId = await createDuoTeamChatroom(sessionId as any);
    await setupRemoteAgentConfig(sessionId as any, chatroomId, machineId, 'builder');
    const configId = await configIdFor(chatroomId);
    await t.run(async (ctx) => {
      await ctx.db.patch('chatroom_teamAgentConfigs', configId, { circuitState: 'open' });
    });
    await t.mutation(api.machines.backfillAgentOperationalStatusForMachine, {
      sessionId: sessionId as any,
      machineId,
    });
    expect((await projectionFor(chatroomId)).role?.operationalState).toBe('circuit_open');
  });

  test('backfill creates projection rows for an existing config', async () => {
    const { sessionId } = await createTestSession('operational-backfill');
    const machineId = 'operational-machine-backfill';
    await registerMachineWithDaemon(sessionId as any, machineId);
    const chatroomId = await createDuoTeamChatroom(sessionId as any);
    await setupRemoteAgentConfig(sessionId as any, chatroomId, machineId, 'builder');
    await t.run(async (ctx) => {
      const roles = await ctx.db
        .query('chatroom_agentRoleOperationalStatus')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .collect();
      for (const role of roles)
        await ctx.db.delete('chatroom_agentRoleOperationalStatus', role._id);
      const summary = await ctx.db
        .query('chatroom_agentOperationalSummary')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .first();
      if (summary) await ctx.db.delete('chatroom_agentOperationalSummary', summary._id);
    });
    await t.mutation(api.machines.backfillAgentOperationalStatusForMachine, {
      sessionId: sessionId as any,
      machineId,
    });
    const projection = await projectionFor(chatroomId);
    expect(projection.role).not.toBeNull();
    expect(projection.summary).not.toBeNull();
  });
});
