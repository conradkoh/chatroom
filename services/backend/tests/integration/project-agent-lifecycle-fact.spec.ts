import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import { buildTeamRoleKey } from '../../convex/utils/teamRoleKey';
import {
  buildAgentStopRevisionKey,
  buildAgentStopTargetKey,
} from '../../src/domain/entities/agent-stop-command';
import { t } from '../../test.setup';
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

async function projectionFor(chatroomId: any) {
  return t.run(async (ctx) => ({
    role: await ctx.db
      .query('chatroom_agentRoleOperationalStatus')
      .withIndex('by_chatroom_role', (q) => q.eq('chatroomId', chatroomId).eq('role', 'builder'))
      .first(),
    summary: await ctx.db
      .query('chatroom_agentOperationalSummary')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
      .first(),
  }));
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
    const projection = await projectionFor(chatroomId);
    expect(projection.role?.operationalState).toBe('running');
    expect(projection.role?.isAlive).toBe(true);
    expect(projection.role?.isRunning).toBe(true);
    expect(projection.summary?.agentStatus).toBe('running');
    expect(projection.summary?.runningRoles).toContain('builder');
  });

  test('daemon disconnect clears isRunning while retaining isAlive', async () => {
    const { sessionId } = await createTestSession('lifecycle-disconnect');
    const machineId = 'lifecycle-machine-disconnect';
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
        pid: 42428,
        revisionKey: 'spawn:disconnect',
        emittedAt: Date.now(),
      },
    });
    await t.mutation(api.machines.updateDaemonStatus, {
      sessionId: sessionId as any,
      machineId,
      connected: false,
    });
    const projection = await projectionFor(chatroomId);
    expect(projection.role?.isAlive).toBe(true);
    expect(projection.role?.isRunning).toBe(false);
    expect(projection.summary?.agentStatus).toBe('stopped');
    expect(projection.summary?.aliveRoles).toContain('builder');
    expect(projection.summary?.runningRoles).toEqual([]);
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
        revisionKey: 'exited:1',
        emittedAt: Date.now(),
      },
    });
    expect((await configFor(chatroomId, 'builder'))!.spawnedAgentPid).toBeUndefined();
  });
  test('stop-command revision clears a matching PID', async () => {
    const { sessionId } = await createTestSession('lifecycle-stop-revision');
    const machineId = 'lifecycle-machine-stop-revision';
    await registerMachineWithDaemon(sessionId as any, machineId);
    const chatroomId = await createDuoTeamChatroom(sessionId as any);
    await setupRemoteAgentConfig(sessionId as any, chatroomId, machineId, 'builder');
    const pid = 42430;
    await t.mutation(api.machines.projectAgentLifecycleFact, {
      sessionId: sessionId as any,
      machineId,
      fact: {
        kind: 'spawned',
        chatroomId,
        role: 'builder',
        pid,
        revisionKey: 'spawn:stop',
        emittedAt: Date.now(),
      },
    });
    const stopCommandId = await t.run(async (ctx) =>
      ctx.db.insert('chatroom_agentStopCommands', {
        chatroomId,
        scope: { kind: 'agent', role: 'builder' },
        scopeKey: 'agent:builder',
        reason: 'user.stop',
        status: 'processing',
        createdAt: Date.now(),
      })
    );
    const targetKey = buildAgentStopTargetKey({ machineId, role: 'builder', pid });
    const revisionKey = buildAgentStopRevisionKey({ stopCommandId, targetKey });
    await t.run(async (ctx) =>
      ctx.db.insert('chatroom_agentStopTargets', {
        stopCommandId,
        chatroomId,
        machineId,
        role: 'builder',
        pid,
        targetKey,
        revisionKey,
        status: 'pending',
      })
    );
    await t.mutation(api.machines.projectAgentLifecycleFact, {
      sessionId: sessionId as any,
      machineId,
      fact: {
        kind: 'exited',
        chatroomId,
        role: 'builder',
        pid,
        revisionKey,
        emittedAt: Date.now(),
      },
    });
    expect((await configFor(chatroomId, 'builder'))!.spawnedAgentPid).toBeUndefined();
  });
  test('stale stop-command revision does not clear a newer PID', async () => {
    const { sessionId } = await createTestSession('lifecycle-stale-stop-revision');
    const machineId = 'lifecycle-machine-stale-stop-revision';
    await registerMachineWithDaemon(sessionId as any, machineId);
    const chatroomId = await createDuoTeamChatroom(sessionId as any);
    await setupRemoteAgentConfig(sessionId as any, chatroomId, machineId, 'builder');
    const oldPid = 42431;
    const newPid = 42432;
    await t.mutation(api.machines.projectAgentLifecycleFact, {
      sessionId: sessionId as any,
      machineId,
      fact: {
        kind: 'spawned',
        chatroomId,
        role: 'builder',
        pid: oldPid,
        revisionKey: 'spawn:old',
        emittedAt: Date.now(),
      },
    });
    await t.run(async (ctx) => {
      const config = await ctx.db
        .query('chatroom_teamAgentConfigs')
        .withIndex('by_teamRoleKey', (q) =>
          q.eq('teamRoleKey', buildTeamRoleKey(chatroomId, 'duo', 'builder'))
        )
        .first();
      if (config) await ctx.db.patch(config._id, { spawnedAgentPid: newPid });
    });
    const stopCommandId = await t.run(async (ctx) =>
      ctx.db.insert('chatroom_agentStopCommands', {
        chatroomId,
        scope: { kind: 'agent', role: 'builder' },
        scopeKey: 'agent:builder',
        reason: 'user.stop',
        status: 'processing',
        createdAt: Date.now(),
      })
    );
    const targetKey = buildAgentStopTargetKey({ machineId, role: 'builder', pid: oldPid });
    const revisionKey = buildAgentStopRevisionKey({ stopCommandId, targetKey });
    await t.run(async (ctx) =>
      ctx.db.insert('chatroom_agentStopTargets', {
        stopCommandId,
        chatroomId,
        machineId,
        role: 'builder',
        pid: oldPid,
        targetKey,
        revisionKey,
        status: 'pending',
      })
    );
    await t.mutation(api.machines.projectAgentLifecycleFact, {
      sessionId: sessionId as any,
      machineId,
      fact: {
        kind: 'exited',
        chatroomId,
        role: 'builder',
        pid: oldPid,
        revisionKey,
        emittedAt: Date.now(),
      },
    });
    expect((await configFor(chatroomId, 'builder'))!.spawnedAgentPid).toBe(newPid);
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
