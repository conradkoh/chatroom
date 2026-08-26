import { describe, expect, test } from 'vitest';

import { registerSpawnedAgentIfAuthorized } from './register-spawned-agent';
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
  const machineId = `register-${id}`;
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
  const config = await t.run((ctx) =>
    ctx.db
      .query('chatroom_teamAgentConfigs')
      .withIndex('by_teamRoleKey', (q) =>
        q.eq('teamRoleKey', buildTeamRoleKey(chatroomId, 'duo', 'builder'))
      )
      .first()
  );
  return { chatroomId, machineId, config: config! };
}

describe('registerSpawnedAgentIfAuthorized', () => {
  test('accepts matching revision and records PID', async () => {
    const { chatroomId, machineId } = await setup('register-accept');
    const result = await t.run((ctx) =>
      registerSpawnedAgentIfAuthorized(ctx, {
        chatroomId,
        role: 'builder',
        machineId,
        pid: 12345,
        lifecycleRevision: 0,
      })
    );
    expect(result).toEqual({ accepted: true });
    const config = await t.run((ctx) =>
      ctx.db
        .query('chatroom_teamAgentConfigs')
        .withIndex('by_teamRoleKey', (q) =>
          q.eq('teamRoleKey', buildTeamRoleKey(chatroomId, 'duo', 'builder'))
        )
        .first()
    );
    expect(config?.spawnedAgentPid).toBe(12345);
  });

  test('rejects stale revision without changing PID', async () => {
    const { chatroomId, machineId, config } = await setup('register-stale');
    await t.run((ctx) => ctx.db.patch(config._id, { lifecycleRevision: 1, spawnedAgentPid: 111 }));
    const result = await t.run((ctx) =>
      registerSpawnedAgentIfAuthorized(ctx, {
        chatroomId,
        role: 'builder',
        machineId,
        pid: 999,
        lifecycleRevision: 0,
      })
    );
    expect(result).toEqual({ accepted: false, reason: 'stale_revision' });
    expect((await t.run((ctx) => ctx.db.get(config._id)))?.spawnedAgentPid).toBe(111);
  });
});
