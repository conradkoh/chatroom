import { describe, expect, test } from 'vitest';

import { rollupAgentStopCommandStatus } from './rollup-agent-stop-command';
import { api } from '../../../../convex/_generated/api';
import { buildTeamRoleKey } from '../../../../convex/utils/teamRoleKey';
import { t } from '../../../../test.setup';

describe('rollupAgentStopCommandStatus', () => {
  test('rolls terminal execution and target to completed', async () => {
    const sessionId = 'rollup-stop-1' as any;
    await t.mutation(api.auth.loginAnon, { sessionId });
    const chatroomId = await t.mutation(api.chatrooms.create, {
      sessionId,
      teamId: 'duo',
      teamName: 'Duo',
      teamRoles: ['planner', 'builder'],
      teamEntryPoint: 'planner',
    });
    const commandId = await t.run(async (ctx) => {
      const id = await ctx.db.insert('chatroom_agentStopCommands', {
        chatroomId,
        scope: { kind: 'chatroom' },
        scopeKey: 'chatroom',
        reason: 'user.stop',
        status: 'processing',
        createdAt: Date.now(),
      });
      await ctx.db.insert('chatroom_agentStopMachineExecutions', {
        stopCommandId: id,
        chatroomId,
        machineId: 'm',
        status: 'completed',
        completedAt: Date.now(),
      });
      await ctx.db.insert('chatroom_agentStopTargets', {
        stopCommandId: id,
        chatroomId,
        machineId: 'm',
        role: 'builder',
        pid: 1,
        targetKey: 'm:builder:1',
        revisionKey: 'r',
        status: 'completed',
        outcome: 'stopped',
        completedAt: Date.now(),
      });
      await rollupAgentStopCommandStatus(ctx, id);
      return id;
    });
    const command = await t.run((ctx) => ctx.db.get('chatroom_agentStopCommands', commandId));
    expect(command?.status).toBe('completed');
  });

  test('restores postStopDesiredState on successful rollup', async () => {
    const sessionId = 'rollup-restore' as any;
    await t.mutation(api.auth.loginAnon, { sessionId });
    const chatroomId = await t.mutation(api.chatrooms.create, {
      sessionId,
      teamId: 'duo',
      teamName: 'Duo',
      teamRoles: ['planner', 'builder'],
      teamEntryPoint: 'planner',
    });
    const commandId = await t.run(async (ctx) => {
      const config = await ctx.db.insert('chatroom_teamAgentConfigs', {
        chatroomId,
        teamRoleKey: buildTeamRoleKey(chatroomId, 'duo', 'builder'),
        role: 'builder',
        type: 'remote',
        machineId: 'm',
        desiredState: 'stopped',
        enabled: true,
        lifecycleRevision: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      const id = await ctx.db.insert('chatroom_agentStopCommands', {
        chatroomId,
        scope: { kind: 'agent', role: 'builder' },
        scopeKey: 'agent:builder',
        reason: 'platform.ephemeral_task_complete',
        postStopDesiredState: 'running',
        status: 'processing',
        createdAt: Date.now(),
      });
      await ctx.db.insert('chatroom_agentStopMachineExecutions', {
        stopCommandId: id,
        chatroomId,
        machineId: 'm',
        status: 'completed',
        completedAt: Date.now(),
      });
      await ctx.db.insert('chatroom_agentStopTargets', {
        stopCommandId: id,
        chatroomId,
        machineId: 'm',
        role: 'builder',
        pid: 1,
        targetKey: 'm:builder:1',
        revisionKey: 'r',
        status: 'completed',
        outcome: 'stopped',
        completedAt: Date.now(),
      });
      await rollupAgentStopCommandStatus(ctx, id);
      expect(config).toBeDefined();
      return id;
    });
    const config = await t.run((ctx) =>
      ctx.db
        .query('chatroom_teamAgentConfigs')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .filter((q) => q.eq(q.field('role'), 'builder'))
        .first()
    );
    expect(config?.desiredState).toBe('running');
    expect(commandId).toBeDefined();
  });
});
