import { describe, expect, test } from 'vitest';
import { api } from '../../convex/_generated/api';
import { buildTeamRoleKey } from '../../convex/utils/teamRoleKey';
import { createAgentStopCommand } from '../../src/domain/usecase/agent/create-agent-stop-command';
import { selectConfigsForAgentStop } from '../../src/domain/usecase/agent/select-agent-stop-configs';
import { t } from '../../test.setup';
import { createDuoTeamChatroom, createTestSession, registerMachineWithDaemon, setupRemoteAgentConfig } from '../helpers/integration';

async function setup(id: string) {
  const { sessionId } = await createTestSession(id);
  const machineId = `revision-${id}`;
  await registerMachineWithDaemon(sessionId, machineId);
  const chatroomId = await createDuoTeamChatroom(sessionId);
  await setupRemoteAgentConfig(sessionId, chatroomId, machineId, 'builder');
  return { sessionId, machineId, chatroomId };
}

async function configFor(chatroomId: any) {
  return t.run((ctx) => ctx.db.query('chatroom_teamAgentConfigs').withIndex('by_teamRoleKey', (q) => q.eq('teamRoleKey', buildTeamRoleKey(chatroomId, 'duo', 'builder'))).first());
}

describe('agent start lifecycle revision fence', () => {
  test('accepts a spawned fact at the current revision', async () => {
    const { sessionId, machineId, chatroomId } = await setup('accept');
    const config = await configFor(chatroomId);
    const result = await t.mutation(api.machines.projectAgentLifecycleFact, { sessionId, machineId, fact: { kind: 'spawned', chatroomId, role: 'builder', pid: 50001, lifecycleRevision: config?.lifecycleRevision ?? 1, revisionKey: 'accept', emittedAt: Date.now() } });
    expect(result.skipped).not.toBe(true);
    expect((await configFor(chatroomId))?.spawnedAgentPid).toBe(50001);
  });

  test('late spawn with pre-stop revision cannot resurrect PID', async () => {
    const { sessionId, machineId, chatroomId } = await setup('late');
    await t.run(async (ctx) => { const config = await ctx.db.query('chatroom_teamAgentConfigs').withIndex('by_teamRoleKey', (q) => q.eq('teamRoleKey', buildTeamRoleKey(chatroomId, 'duo', 'builder'))).first(); if (config) await ctx.db.patch(config._id, { spawnedAgentPid: 50002 }); });
    const before = await configFor(chatroomId);
    await t.run(async (ctx) => createAgentStopCommand(ctx, { chatroomId, scope: { kind: 'chatroom' }, reason: 'user.stop', selectedConfigs: await selectConfigsForAgentStop(ctx, { chatroomId, scope: { kind: 'chatroom' } }) }));
    const after = await configFor(chatroomId);
    expect(after?.desiredState).toBe('stopped');
    const result = await t.mutation(api.machines.projectAgentLifecycleFact, { sessionId, machineId, fact: { kind: 'spawned', chatroomId, role: 'builder', pid: 6248, lifecycleRevision: before?.lifecycleRevision ?? 0, revisionKey: 'late', emittedAt: Date.now() } });
    expect(result.skipped).toBe(true);
    expect(result.rejectionReason).toBe('stale_revision');
    expect((await configFor(chatroomId))?.spawnedAgentPid).not.toBe(6248);
  });

  test('updateSpawnedAgent rejects stale revision', async () => {
    const { sessionId, machineId, chatroomId } = await setup('update');
    const config = await configFor(chatroomId);
    await t.run((ctx) => ctx.db.patch(config!._id, { lifecycleRevision: (config?.lifecycleRevision ?? 0) + 1 }));
    const result = await t.mutation(api.machines.updateSpawnedAgent, { sessionId, machineId, chatroomId, role: 'builder', pid: 50003, lifecycleRevision: config?.lifecycleRevision ?? 0 });
    expect(result.accepted).toBe(false);
    expect(result.reason).toBe('stale_revision');
  });
});
