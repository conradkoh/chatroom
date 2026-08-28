import { describe, expect, test } from 'vitest';

import { createAgentStopCommand } from './create-agent-stop-command';
import { releaseEphemeralAgentRole } from './release-ephemeral-agent-role';
import { requestEphemeralAgentRelease } from './request-ephemeral-agent-release';
import { selectConfigsForAgentStop } from './select-agent-stop-configs';
import { api } from '../../../../convex/_generated/api';
import { buildTeamRoleKey } from '../../../../convex/utils/teamRoleKey';
import { t } from '../../../../test.setup';

describe('releaseEphemeralAgentRole', () => {
  test('projects enhancer offline after participant registration', async () => {
    const sessionId = 'release-ephemeral-role' as any;
    await t.mutation(api.auth.loginAnon, { sessionId });
    const chatroomId = await t.mutation(api.chatrooms.create, {
      sessionId,
      teamId: 'duo',
      teamName: 'Duo',
      teamRoles: ['planner', 'enhancer', 'builder'],
      teamEntryPoint: 'planner',
    });
    await t.run(async (ctx) => {
      await ctx.db.insert('chatroom_participants', {
        chatroomId,
        role: 'enhancer',
        machineId: 'ephemeral-machine',
        agentType: 'remote',
        lastSeenAt: Date.now(),
        lastSeenAction: 'enhancer:started',
        connectionId: 'job-1',
      });
      await ctx.db.insert('chatroom_agentRoleStatusReadModel', {
        chatroomId,
        role: 'enhancer',
        roleKind: 'ephemeral',
        status: 'working',
        projectedAt: Date.now(),
      });
      await releaseEphemeralAgentRole(ctx, { chatroomId, role: 'enhancer' });
    });
    const status = await t.run((ctx) =>
      ctx.db
        .query('chatroom_agentRoleStatusReadModel')
        .withIndex('by_chatroom_role', (q) => q.eq('chatroomId', chatroomId).eq('role', 'enhancer'))
        .first()
    );
    expect(status?.status).toBe('offline');
  });
});

describe('createAgentStopCommand chatroom stop', () => {
  test('releases stuck ephemeral enhancer and enqueues daemon stop for its machine', async () => {
    const sessionId = 'chatroom-stop-ephemeral' as any;
    const login = await t.mutation(api.auth.loginAnon, { sessionId });
    const chatroomId = await t.mutation(api.chatrooms.create, {
      sessionId,
      teamId: 'duo',
      teamName: 'Duo',
      teamRoles: ['planner', 'enhancer', 'builder'],
      teamEntryPoint: 'planner',
    });
    const machineId = 'enhancer-stop-machine';
    await t.mutation(api.machines.register, {
      sessionId,
      machineId,
      hostname: 'test',
      os: 'linux',
      availableHarnesses: ['opencode'],
    });

    await t.run(async (ctx) => {
      const room = await ctx.db.get(chatroomId);
      await ctx.db.insert('chatroom_teamAgentConfigs', {
        teamRoleKey: buildTeamRoleKey(chatroomId, room!.teamId!, 'enhancer'),
        chatroomId,
        role: 'enhancer',
        type: 'remote',
        machineId,
        agentHarness: 'opencode',
        model: 'test',
        workingDir: '/tmp',
        enabled: true,
        desiredState: 'running',
        lifecycleRevision: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      await ctx.db.insert('chatroom_participants', {
        chatroomId,
        role: 'enhancer',
        machineId,
        agentType: 'remote',
        lastSeenAt: Date.now(),
        lastSeenAction: 'enhancer:started',
        connectionId: 'job-1',
      });
      await ctx.db.insert('chatroom_agentRoleStatusReadModel', {
        chatroomId,
        role: 'enhancer',
        roleKind: 'ephemeral',
        status: 'working',
        projectedAt: Date.now(),
      });
      await ctx.db.insert('chatroom_enhancerJobs', {
        chatroomId,
        userId: login.userId,
        targetId: 'handoff:planner-to-builder',
        fromRole: 'planner',
        toRole: 'enhancer',
        status: 'running',
        draftContent: 'draft',
        templateSnapshot: 'template',
        agentHarness: 'opencode',
        model: 'test',
        machineId,
        workingDir: '/tmp',
        attemptCount: 1,
        maxAttempts: 3,
        runningSince: Date.now(),
        createdAt: Date.now(),
      });
    });

    const result = await t.run(async (ctx) =>
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

    const status = await t.run((ctx) =>
      ctx.db
        .query('chatroom_agentRoleStatusReadModel')
        .withIndex('by_chatroom_role', (q) => q.eq('chatroomId', chatroomId).eq('role', 'enhancer'))
        .first()
    );
    const execution = await t.run((ctx) =>
      ctx.db
        .query('chatroom_agentStopMachineExecutions')
        .withIndex('by_stopCommandId', (q) => q.eq('stopCommandId', result.stopCommandId))
        .first()
    );
    const command = await t.run((ctx) =>
      ctx.db.get('chatroom_agentStopCommands', result.stopCommandId)
    );

    expect(status?.status).toBe('offline');
    expect(execution?.machineId).toBe(machineId);
    expect(command?.status).toBe('pending');
  });

  test('releases enhancer when persisted teamRoles omit it but runtime state exists', async () => {
    const sessionId = 'chatroom-stop-orphan-enhancer' as any;
    await t.mutation(api.auth.loginAnon, { sessionId });
    const chatroomId = await t.mutation(api.chatrooms.create, {
      sessionId,
      teamId: 'duo',
      teamName: 'Duo',
      teamRoles: ['planner', 'builder'],
      teamEntryPoint: 'planner',
    });
    const machineId = 'orphan-enhancer-machine';
    await t.mutation(api.machines.register, {
      sessionId,
      machineId,
      hostname: 'test',
      os: 'linux',
      availableHarnesses: ['opencode'],
    });

    await t.run(async (ctx) => {
      const room = await ctx.db.get(chatroomId);
      await ctx.db.insert('chatroom_teamAgentConfigs', {
        teamRoleKey: buildTeamRoleKey(chatroomId, room!.teamId!, 'enhancer'),
        chatroomId,
        role: 'enhancer',
        type: 'remote',
        machineId,
        agentHarness: 'opencode',
        model: 'test',
        workingDir: '/tmp',
        enabled: true,
        desiredState: 'running',
        lifecycleRevision: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      await ctx.db.insert('chatroom_participants', {
        chatroomId,
        role: 'enhancer',
        machineId,
        agentType: 'remote',
        lastSeenAt: Date.now(),
        lastSeenAction: 'enhancer:started',
        lastStatus: 'task.inProgress',
        connectionId: 'job-orphan',
      });
      await ctx.db.insert('chatroom_agentRoleStatusReadModel', {
        chatroomId,
        role: 'enhancer',
        roleKind: 'ephemeral',
        status: 'working',
        projectedAt: Date.now(),
      });
    });

    await t.run(async (ctx) =>
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

    const status = await t.run((ctx) =>
      ctx.db
        .query('chatroom_agentRoleStatusReadModel')
        .withIndex('by_chatroom_role', (q) => q.eq('chatroomId', chatroomId).eq('role', 'enhancer'))
        .first()
    );
    expect(status?.status).toBe('offline');
  });
});

describe('requestEphemeralAgentRelease without PID', () => {
  test('clears enhancer status when no stoppable config exists', async () => {
    const sessionId = 'release-ephemeral-no-pid' as any;
    await t.mutation(api.auth.loginAnon, { sessionId });
    const chatroomId = await t.mutation(api.chatrooms.create, {
      sessionId,
      teamId: 'duo',
      teamName: 'Duo',
      teamRoles: ['planner', 'enhancer', 'builder'],
      teamEntryPoint: 'planner',
    });
    await t.run(async (ctx) => {
      const room = await ctx.db.get(chatroomId);
      await ctx.db.insert('chatroom_teamAgentConfigs', {
        teamRoleKey: buildTeamRoleKey(chatroomId, room!.teamId!, 'enhancer'),
        chatroomId,
        role: 'enhancer',
        type: 'remote',
        machineId: 'ephemeral-machine',
        agentHarness: 'opencode',
        model: 'test',
        workingDir: '/tmp',
        enabled: true,
        desiredState: 'stopped',
        lifecycleRevision: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      await ctx.db.insert('chatroom_participants', {
        chatroomId,
        role: 'enhancer',
        machineId: 'ephemeral-machine',
        agentType: 'remote',
        lastSeenAt: Date.now(),
        lastSeenAction: 'enhancer:started',
        connectionId: 'job-1',
      });
      await ctx.db.insert('chatroom_agentRoleStatusReadModel', {
        chatroomId,
        role: 'enhancer',
        roleKind: 'ephemeral',
        status: 'working',
        projectedAt: Date.now(),
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
      await requestEphemeralAgentRelease(ctx, (await ctx.db.get(taskId))!);
    });
    const status = await t.run((ctx) =>
      ctx.db
        .query('chatroom_agentRoleStatusReadModel')
        .withIndex('by_chatroom_role', (q) => q.eq('chatroomId', chatroomId).eq('role', 'enhancer'))
        .first()
    );
    expect(status?.status).toBe('offline');
  });
});
