import { describe, expect, test } from 'vitest';
import { api } from '../../../../convex/_generated/api';
import { t } from '../../../../test.setup';
import { createAgentStopCommand } from './create-agent-stop-command';
import { selectConfigsForAgentStop } from './select-agent-stop-configs';

describe('supersedeInflightAgentStopCommands', () => {
  test('terminalizes prior command targets', async () => {
    const sessionId = 'supersede-spec' as any;
    await t.mutation(api.auth.loginAnon, { sessionId });
    const chatroomId = await t.mutation(api.chatrooms.create, {
      sessionId,
      teamId: 'duo',
      teamName: 'Duo',
      teamRoles: ['planner', 'builder'],
      teamEntryPoint: 'planner',
    });
    await t.mutation(api.machines.register, {
      sessionId,
      machineId: 'supersede-machine',
      hostname: 'test',
      os: 'linux',
      availableHarnesses: ['opencode'],
    });
    await t.mutation(api.machines.saveTeamAgentConfig, {
      sessionId,
      chatroomId,
      role: 'builder',
      type: 'remote',
      machineId: 'supersede-machine',
      agentHarness: 'opencode',
    });
    await t.run(async (ctx) => {
      const config = await ctx.db
        .query('chatroom_teamAgentConfigs')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .first();
      if (config) await ctx.db.patch(config._id, { spawnedAgentPid: 1 });
    });
    const first = await t.run(async (ctx) =>
      createAgentStopCommand(ctx, {
        chatroomId,
        scope: { kind: 'chatroom' },
        reason: 'user.stop',
        selectedConfigs: await selectConfigsForAgentStop(ctx, {
          chatroomId,
          scope: { kind: 'chatroom' },
        }),
      })
    );
    const second = await t.run(async (ctx) =>
      createAgentStopCommand(ctx, {
        chatroomId,
        scope: { kind: 'agent', role: 'builder' },
        reason: 'user.stop',
        selectedConfigs: await selectConfigsForAgentStop(ctx, {
          chatroomId,
          scope: { kind: 'agent', role: 'builder' },
          machineId: 'supersede-machine',
        }),
      })
    );
    expect(second.stopCommandId).not.toBe(first.stopCommandId);
    const command = await t.run((ctx) =>
      ctx.db.get('chatroom_agentStopCommands', first.stopCommandId)
    );
    expect(command?.status).toBe('superseded');
  });
});
