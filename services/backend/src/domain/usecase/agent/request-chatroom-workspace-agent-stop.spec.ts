import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { projectAgentRoleStatusReadModel } from './project-agent-role-status-read-model';
import { api } from '../../../../convex/_generated/api';
import type { Id } from '../../../../convex/_generated/dataModel';
import { buildTeamRoleKey } from '../../../../convex/utils/teamRoleKey';
import { t } from '../../../../test.setup';

describe('requestChatroomWorkspaceAgentStop', () => {
  test('resets stale read-model activity before daemon acknowledgement', async () => {
    const sessionId = 'request-stop-reset' as SessionId;
    await t.mutation(api.auth.loginAnon, { sessionId });
    const chatroomId = await t.mutation(api.chatrooms.create, {
      sessionId,
      teamId: 'duo',
      teamName: 'Duo',
      teamRoles: ['planner', 'builder'],
      teamEntryPoint: 'planner',
    });

    await t.run(async (ctx) => {
      await ctx.db.insert('chatroom_teamAgentConfigs', {
        teamRoleKey: buildTeamRoleKey(chatroomId, 'duo', 'builder'),
        chatroomId,
        role: 'builder',
        type: 'remote',
        machineId: 'offline-daemon',
        agentHarness: 'opencode',
        model: 'test-model',
        workingDir: '/tmp/test',
        enabled: true,
        desiredState: 'running',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      await projectAgentRoleStatusReadModel(ctx, {
        chatroomId,
        role: 'builder',
        event: { status: 'waiting' },
      });
    });

    const result = await t.mutation(api.chatroomWorkspaceAgentCommandsInbox.requestStopAll, {
      sessionId,
      chatroomId: chatroomId as Id<'chatroom_rooms'>,
    });

    expect(result.commandIds).toHaveLength(1);
    const state = await t.run(async (ctx) => {
      const config = await ctx.db
        .query('chatroom_teamAgentConfigs')
        .withIndex('by_teamRoleKey', (q) =>
          q.eq('teamRoleKey', buildTeamRoleKey(chatroomId, 'duo', 'builder'))
        )
        .first();
      const row = await ctx.db
        .query('chatroom_agentRoleStatusReadModel')
        .withIndex('by_chatroom_role', (q) => q.eq('chatroomId', chatroomId).eq('role', 'builder'))
        .first();
      return { desiredState: config?.desiredState, status: row?.status };
    });

    expect(state).toEqual({ desiredState: 'stopped', status: 'offline' });
  });
});
