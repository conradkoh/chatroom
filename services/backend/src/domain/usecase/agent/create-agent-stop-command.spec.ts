import { describe, expect, test } from 'vitest';

import { createAgentStopCommand } from './create-agent-stop-command';
import { selectConfigsForAgentStop } from './select-agent-stop-configs';
import { api } from '../../../../convex/_generated/api';
import { buildTeamRoleKey } from '../../../../convex/utils/teamRoleKey';
import { t } from '../../../../test.setup';

async function setup(id: string) {
  const login = await t.mutation(api.auth.loginAnon, { sessionId: id as any });
  const chatroomId = await t.mutation(api.chatrooms.create, {
    sessionId: id as any,
    teamId: 'duo',
    teamName: 'Duo',
    teamRoles: ['planner', 'builder'],
    teamEntryPoint: 'planner',
  });
  const machineId = `stop-test-${id}`;
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
  return { chatroomId, machineId, userId: login.userId };
}

describe('createAgentStopCommand', () => {
  test('supersedes inflight command per chatroom', async () => {
    const { chatroomId, machineId } = await setup('stop-command-supersede');
    await t.run(async (ctx) => {
      const config = await ctx.db
        .query('chatroom_teamAgentConfigs')
        .withIndex('by_teamRoleKey', (q) =>
          q.eq('teamRoleKey', buildTeamRoleKey(chatroomId, 'duo', 'builder'))
        )
        .first();
      if (config) await ctx.db.patch(config._id, { spawnedAgentPid: 12345 });
    });
    const first = await t.run(async (ctx) =>
      createAgentStopCommand(ctx, {
        chatroomId,
        scope: { kind: 'agent', role: 'builder' },
        reason: 'user.stop',
        selectedConfigs: await selectConfigsForAgentStop(ctx, {
          chatroomId,
          scope: { kind: 'agent', role: 'builder' },
          machineId,
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
          machineId,
        }),
      })
    );
    expect(second.stopCommandId).not.toBe(first.stopCommandId);
    expect(second.stopCommandId).not.toBe(first.stopCommandId);
    const command = await t.run((ctx) =>
      ctx.db.get('chatroom_agentStopCommands', first.stopCommandId)
    );
    expect(command?.status).toBe('superseded');
  });
  test('filters role targets', async () => {
    const { chatroomId, machineId: _machineId } = await setup('stop-command-filter');
    const result = await t.run((ctx) =>
      createAgentStopCommand(ctx, {
        chatroomId,
        scope: { kind: 'agent', role: 'planner' },
        reason: 'user.stop',
        selectedConfigs: [],
      })
    );
    const targets = await t.run((ctx) =>
      ctx.db
        .query('chatroom_agentStopTargets')
        .withIndex('by_stopCommandId', (q) => q.eq('stopCommandId', result.stopCommandId))
        .collect()
    );
    expect(targets).toHaveLength(0);
  });
  test('completes zero-target command', async () => {
    const { chatroomId, machineId: _machineId } = await setup('stop-command-empty');
    const result = await t.run((ctx) =>
      createAgentStopCommand(ctx, {
        chatroomId,
        scope: { kind: 'agent', role: 'planner' },
        reason: 'user.stop',
        selectedConfigs: [],
      })
    );
    const command = await t.run((ctx) =>
      ctx.db.get('chatroom_agentStopCommands', result.stopCommandId)
    );
    expect(command?.status).toBe('completed');
  });
});
