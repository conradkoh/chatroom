import { describe, expect, test } from 'vitest';

import { registerSpawnedAgentIfAuthorized } from './register-spawned-agent';
import { api } from '../../../../convex/_generated/api';
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
  await t.mutation(api.machines.sendCommand, {
    sessionId: id as any,
    machineId,
    type: 'start-agent',
    payload: {
      chatroomId,
      role: 'builder',
      model: 'test-model',
      agentHarness: 'opencode',
      workingDir: '/workspace',
    },
  });
  return { chatroomId, machineId };
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
      })
    );
    expect(result).toEqual({ accepted: true });
    const status = await t.run((ctx) =>
      ctx.db
        .query('chatroom_agentRoleStatusReadModel')
        .withIndex('by_chatroom_role', (q) => q.eq('chatroomId', chatroomId).eq('role', 'builder'))
        .first()
    );
    expect(status?.observedPid).toBe(12345);
  });
});
