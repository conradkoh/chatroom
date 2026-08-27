import { describe, expect, test } from 'vitest';

import { requestEphemeralAgentRelease } from './request-ephemeral-agent-release';
import { api } from '../../../../convex/_generated/api';
import { buildTeamRoleKey } from '../../../../convex/utils/teamRoleKey';
import { t } from '../../../../test.setup';

describe('requestEphemeralAgentRelease', () => {
  test('creates a running-capacity release for an enhancer task', async () => {
    const sessionId = 'ephemeral-release' as any;
    await t.mutation(api.auth.loginAnon, { sessionId });
    const chatroomId = await t.mutation(api.chatrooms.create, {
      sessionId,
      teamId: 'duo',
      teamName: 'Duo',
      teamRoles: ['planner', 'enhancer', 'builder'],
      teamEntryPoint: 'planner',
    });
    const machineId = 'ephemeral-machine';
    await t.mutation(api.machines.register, {
      sessionId,
      machineId,
      hostname: 'test',
      os: 'linux',
      availableHarnesses: ['opencode'],
    });
    const ids = await t.run(async (ctx) => {
      const _room = await ctx.db.get(chatroomId);
      const configId = await ctx.db.insert('chatroom_teamAgentConfigs', {
        teamRoleKey: buildTeamRoleKey(chatroomId, 'duo', 'enhancer'),
        chatroomId,
        role: 'enhancer',
        type: 'remote',
        machineId,
        agentHarness: 'opencode',
        model: 'test',
        workingDir: '/tmp',
        enabled: true,
        desiredState: 'running',
        spawnedAgentPid: 4242,
        lifecycleRevision: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      const taskId = await ctx.db.insert('chatroom_tasks', {
        chatroomId,
        createdBy: 'planner',
        content: 'enhance',
        assignedTo: 'enhancer',
        status: 'completed',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        queuePosition: 1,
      });
      await requestEphemeralAgentRelease(ctx, (await ctx.db.get(taskId)) as any);
      return { configId };
    });
    const command = await t.run((ctx) =>
      ctx.db
        .query('chatroom_agentStopCommands')
        .withIndex('by_chatroom_scopeKey_status', (q) =>
          q.eq('chatroomId', chatroomId).eq('scopeKey', 'agent:enhancer')
        )
        .first()
    );
    expect(command?.reason).toBe('platform.ephemeral_task_complete');
    expect(command?.postStopDesiredState).toBe('stopped');
    expect(ids.configId).toBeDefined();
  });
});
