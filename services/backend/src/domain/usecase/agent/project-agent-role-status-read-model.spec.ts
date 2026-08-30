import { describe, expect, test } from 'vitest';

import {
  projectAgentRoleStatusReadModel,
  statusEventForAgentEvent,
  touchAgentRoleStatusLastSeen,
} from './project-agent-role-status-read-model';
import { api } from '../../../../convex/_generated/api';
import { buildTeamRoleKey } from '../../../../convex/utils/teamRoleKey';
import { t } from '../../../../test.setup';

describe('statusEventForAgentEvent', () => {
  test('maps task.acknowledged to working so online agents show active work, not starting', () => {
    expect(statusEventForAgentEvent('task.acknowledged')).toEqual({ status: 'working' });
  });

  test('keeps agent boot events on starting', () => {
    expect(statusEventForAgentEvent('agent.requestStart')).toEqual({ status: 'starting' });
    expect(statusEventForAgentEvent('agent.started')).toEqual({ status: 'starting' });
  });
});

describe('projectAgentRoleStatusReadModel', () => {
  test('projects config and active task without a participant row', async () => {
    const sessionId = 'role-status-projection' as any;
    await t.mutation(api.auth.loginAnon, { sessionId });
    const chatroomId = await t.mutation(api.chatrooms.create, {
      sessionId,
      teamId: 'duo',
      teamName: 'Duo',
      teamRoles: ['planner', 'enhancer', 'builder'],
      teamEntryPoint: 'planner',
    });

    await t.run(async (ctx) => {
      await ctx.db.insert('chatroom_teamAgentConfigs', {
        teamRoleKey: buildTeamRoleKey(chatroomId, 'duo', 'enhancer'),
        chatroomId,
        role: 'enhancer',
        type: 'remote',
        machineId: 'configured-machine',
        agentHarness: 'opencode',
        model: 'test',
        workingDir: '/tmp',
        enabled: true,
        desiredState: 'running',
        lifecycleRevision: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      await ctx.db.insert('chatroom_tasks', {
        chatroomId,
        createdBy: 'planner',
        content: 'enhance',
        assignedTo: 'enhancer',
        status: 'in_progress',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        queuePosition: 1,
      });
      await projectAgentRoleStatusReadModel(ctx, {
        chatroomId,
        role: 'enhancer',
        event: { status: 'working' },
      });
    });

    const row = await t.run((ctx) =>
      ctx.db
        .query('chatroom_agentRoleStatusReadModel')
        .withIndex('by_chatroom_role', (q) => q.eq('chatroomId', chatroomId).eq('role', 'enhancer'))
        .first()
    );
    expect(row?.machineId).toBe('configured-machine');
    expect(row?.activeWork?.kind).toBe('task');
    expect(row?.lastSeenAt).toBeUndefined();

    await t.run((ctx) =>
      touchAgentRoleStatusLastSeen(ctx, { chatroomId, role: 'enhancer', lastSeenAt: 123 })
    );
    const touched = await t.run((ctx) => ctx.db.get('chatroom_agentRoleStatusReadModel', row!._id));
    expect(touched?.lastSeenAt).toBe(123);
  });

  test('projects acknowledged task as working with activeWork', async () => {
    const sessionId = 'role-status-acknowledged' as any;
    await t.mutation(api.auth.loginAnon, { sessionId });
    const chatroomId = await t.mutation(api.chatrooms.create, {
      sessionId,
      teamId: 'duo',
      teamName: 'Duo',
      teamRoles: ['planner', 'builder'],
      teamEntryPoint: 'planner',
    });
    const taskId = await t.run(async (ctx) => {
      return await ctx.db.insert('chatroom_tasks', {
        chatroomId,
        createdBy: 'planner',
        content: 'build it',
        assignedTo: 'builder',
        status: 'acknowledged',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        queuePosition: 1,
      });
    });

    await t.run(async (ctx) => {
      await projectAgentRoleStatusReadModel(ctx, {
        chatroomId,
        role: 'builder',
        event: statusEventForAgentEvent('task.acknowledged'),
      });
    });

    const row = await t.run((ctx) =>
      ctx.db
        .query('chatroom_agentRoleStatusReadModel')
        .withIndex('by_chatroom_role', (q) => q.eq('chatroomId', chatroomId).eq('role', 'builder'))
        .first()
    );
    expect(row?.status).toBe('working');
    expect(row?.activeWork).toEqual({ kind: 'task', id: taskId });
  });
});
