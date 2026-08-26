import { describe, expect, test } from 'vitest';

import { authorizeAgentStart } from './authorize-agent-start';
import { api } from '../../../../convex/_generated/api';
import { buildTeamRoleKey } from '../../../../convex/utils/teamRoleKey';
import { t } from '../../../../test.setup';

async function setup(id: string) {
  await t.mutation(api.auth.loginAnon, { sessionId: id as any });
  const chatroomId = await t.mutation(api.chatrooms.create, {
    sessionId: id as any,
    teamId: 'duo',
    teamName: 'Duo',
    teamRoles: ['planner', 'builder'],
    teamEntryPoint: 'planner',
  });
  const machineId = `authorize-${id}`;
  await t.mutation(api.machines.register, {
    sessionId: id as any,
    machineId,
    hostname: 'test',
    os: 'linux',
    availableHarnesses: ['opencode'],
  });
  await t.mutation(api.machines.saveTeamAgentConfig, {
    sessionId: id as any,
    chatroomId,
    role: 'builder',
    type: 'remote',
    machineId,
    agentHarness: 'opencode',
  });
  return { chatroomId, machineId };
}

async function configId(chatroomId: any) {
  return t.run((ctx) =>
    ctx.db
      .query('chatroom_teamAgentConfigs')
      .withIndex('by_teamRoleKey', (q) =>
        q.eq('teamRoleKey', buildTeamRoleKey(chatroomId, 'duo', 'builder'))
      )
      .first()
  );
}

describe('authorizeAgentStart', () => {
  test('allows matching revision and rejects stale, stopped, disabled, and wrong machine', async () => {
    const { chatroomId, machineId } = await setup('authorize-cases');
    expect(
      await t.run((ctx) =>
        authorizeAgentStart(ctx, { chatroomId, role: 'builder', machineId, lifecycleRevision: 0 })
      )
    ).toEqual({ allowed: true, lifecycleRevision: 0 });
    const config = await configId(chatroomId);
    await t.run((ctx) => ctx.db.patch(config!._id, { lifecycleRevision: 2 }));
    expect(
      await t.run((ctx) =>
        authorizeAgentStart(ctx, { chatroomId, role: 'builder', machineId, lifecycleRevision: 0 })
      )
    ).toEqual({ allowed: false, reason: 'stale_revision' });
    await t.run((ctx) =>
      ctx.db.patch(config!._id, { lifecycleRevision: 2, desiredState: 'stopped' })
    );
    expect(
      (await t.run((ctx) => authorizeAgentStart(ctx, { chatroomId, role: 'builder', machineId })))
        .reason
    ).toBe('stopped');
    await t.run((ctx) => ctx.db.patch(config!._id, { desiredState: 'running', enabled: false }));
    expect(
      (await t.run((ctx) => authorizeAgentStart(ctx, { chatroomId, role: 'builder', machineId })))
        .reason
    ).toBe('disabled');
    expect(
      (
        await t.run((ctx) =>
          authorizeAgentStart(ctx, { chatroomId, role: 'builder', machineId: 'wrong' })
        )
      ).reason
    ).toBe('not_configured');
  });

  test('rejects an in-flight chatroom stop', async () => {
    const { chatroomId, machineId } = await setup('authorize-stop');
    await t.run((ctx) =>
      ctx.db.insert('chatroom_agentStopCommands', {
        chatroomId,
        scope: { kind: 'chatroom' },
        scopeKey: 'chatroom',
        reason: 'user.stop',
        status: 'pending',
        createdAt: Date.now(),
      })
    );
    expect(
      await t.run((ctx) => authorizeAgentStart(ctx, { chatroomId, role: 'builder', machineId }))
    ).toEqual({ allowed: false, reason: 'stop_in_flight' });
  });

  test('requires an active task for ephemeral enhancer starts', async () => {
    const { chatroomId, machineId } = await setup('authorize-ephemeral');
    const enhancerId = await t.run(async (ctx) =>
      ctx.db.insert('chatroom_teamAgentConfigs', {
        teamRoleKey: buildTeamRoleKey(chatroomId, 'duo', 'enhancer'),
        chatroomId,
        role: 'enhancer',
        type: 'remote',
        machineId,
        agentHarness: 'opencode',
        model: 'test',
        workingDir: '/workspace',
        enabled: true,
        desiredState: 'running',
        lifecycleRevision: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
    );
    expect(enhancerId).toBeDefined();
    expect(
      await t.run((ctx) => authorizeAgentStart(ctx, { chatroomId, role: 'enhancer', machineId }))
    ).toEqual({ allowed: false, reason: 'no_active_task' });
    const taskId = await t.run((ctx) =>
      ctx.db.insert('chatroom_tasks', {
        chatroomId,
        createdBy: 'user',
        content: 'Enhance',
        status: 'pending',
        assignedTo: 'enhancer',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        queuePosition: 1,
      })
    );
    expect(
      await t.run((ctx) =>
        authorizeAgentStart(ctx, { chatroomId, role: 'enhancer', machineId, taskId })
      )
    ).toEqual({ allowed: true, lifecycleRevision: 0 });
    await t.run((ctx) => ctx.db.patch('chatroom_tasks', taskId, { status: 'completed' }));
    expect(
      await t.run((ctx) =>
        authorizeAgentStart(ctx, { chatroomId, role: 'enhancer', machineId, taskId })
      )
    ).toEqual({ allowed: false, reason: 'no_active_task' });
  });
});
