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

async function configFor(chatroomId: any, role: string) {
  return t.run(async (ctx) => {
    const room = await ctx.db.get(chatroomId);
    return ctx.db
      .query('chatroom_teamAgentConfigs')
      .withIndex('by_teamRoleKey', (q) =>
        q.eq('teamRoleKey', buildTeamRoleKey(chatroomId, room!.teamId!, role))
      )
      .first();
  });
}

describe('projectAgentLifecycleFact', () => {
  test('spawned sets PID and participant status', async () => {
    const { sessionId } = await createTestSession('lifecycle-spawn');
    const machineId = 'lifecycle-machine-spawn';
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
        pid: 42424,
        revisionKey: 'spawn:1',
        emittedAt: Date.now(),
      },
    });
    expect((await configFor(chatroomId, 'builder'))!.spawnedAgentPid).toBe(42424);
  });
  test('spawned is idempotent for the same PID', async () => {
    const { sessionId } = await createTestSession('lifecycle-idem');
    const machineId = 'lifecycle-machine-idem';
    await registerMachineWithDaemon(sessionId as any, machineId);
    const chatroomId = await createDuoTeamChatroom(sessionId as any);
    await setupRemoteAgentConfig(sessionId as any, chatroomId, machineId, 'builder');
    const fact = {
      kind: 'spawned' as const,
      chatroomId,
      role: 'builder',
      pid: 42425,
      revisionKey: 'spawn:idem',
      emittedAt: Date.now(),
    };
    await t.mutation(api.machines.projectAgentLifecycleFact, {
      sessionId: sessionId as any,
      machineId,
      fact,
    });
    const result = await t.mutation(api.machines.projectAgentLifecycleFact, {
      sessionId: sessionId as any,
      machineId,
      fact,
    });
    expect(result.skipped).toBe(true);
  });
  test('exited clears a matching PID', async () => {
    const { sessionId } = await createTestSession('lifecycle-exit');
    const machineId = 'lifecycle-machine-exit';
    await registerMachineWithDaemon(sessionId as any, machineId);
    const chatroomId = await createDuoTeamChatroom(sessionId as any);
    await setupRemoteAgentConfig(sessionId as any, chatroomId, machineId, 'builder');
    const base = {
      sessionId: sessionId as any,
      machineId,
      fact: {
        kind: 'spawned' as const,
        chatroomId,
        role: 'builder',
        pid: 42426,
        revisionKey: 'spawn:exit',
        emittedAt: Date.now(),
      },
    };
    await t.mutation(api.machines.projectAgentLifecycleFact, base);
    await t.mutation(api.machines.projectAgentLifecycleFact, {
      sessionId: sessionId as any,
      machineId,
      fact: {
        kind: 'exited',
        chatroomId,
        role: 'builder',
        pid: 42426,
        revisionKey: 'exit:1',
        emittedAt: Date.now(),
      },
    });
    expect((await configFor(chatroomId, 'builder'))!.spawnedAgentPid).toBeUndefined();
  });
  test('cleared_all_pids clears machine configs', async () => {
    const { sessionId } = await createTestSession('lifecycle-clear');
    const machineId = 'lifecycle-machine-clear';
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
        pid: 42427,
        revisionKey: 'spawn:clear',
        emittedAt: Date.now(),
      },
    });
    const result = await t.mutation(api.machines.projectAgentLifecycleFact, {
      sessionId: sessionId as any,
      machineId,
      fact: { kind: 'cleared_all_pids', revisionKey: 'clear:1', emittedAt: Date.now() },
    });
    expect(result.clearedCount).toBeGreaterThanOrEqual(1);
    expect((await configFor(chatroomId, 'builder'))!.spawnedAgentPid).toBeUndefined();
  });
});
