import { describe, expect, test } from 'vitest';

import { api } from '../../../../convex/_generated/api';
import { buildTeamRoleKey } from '../../../../convex/utils/teamRoleKey';
import { t } from '../../../../test.setup';
import {
  projectAgentRoleStatusReadModel,
  touchAgentRoleStatusLastSeen,
} from './project-agent-role-status-read-model';

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
});
