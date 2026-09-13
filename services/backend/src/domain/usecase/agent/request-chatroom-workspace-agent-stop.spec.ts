import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { projectAgentRoleStatusReadModel } from './project-agent-role-status-read-model';
import { api } from '../../../../convex/_generated/api';
import type { Id } from '../../../../convex/_generated/dataModel';
import { buildTeamRoleKey } from '../../../../convex/utils/teamRoleKey';
import { t } from '../../../../test.setup';

describe('requestChatroomWorkspaceAgentStop', () => {
  test('enqueues an explicit stop command without mutating daemon state', async () => {
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
      const configId = await ctx.db.insert('chatroom_agentDesiredConfigs', {
        teamRoleKey: buildTeamRoleKey(chatroomId, 'duo', 'builder'),
        chatroomId,
        role: 'builder',
        type: 'remote',
        machineId: 'offline-daemon',
        agentHarness: 'opencode',
        model: 'test-model',
        workingDir: '/tmp/test',
        enabled: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      await ctx.db.insert('chatroom_agentRuntimeStates', {
        desiredConfigId: configId,
        chatroomId,
        role: 'builder',
        machineId: 'offline-daemon',
        status: 'waiting',
        desiredState: 'running',
        updatedAt: Date.now(),
      });
      await projectAgentRoleStatusReadModel(ctx, {
        chatroomId,
        role: 'builder',
        event: { status: 'waiting' },
      });
    });

    const result = await t.mutation(api.agents.requestStopAll, {
      sessionId,
      chatroomId: chatroomId as Id<'chatroom_rooms'>,
    });

    expect(result.commandIds).toHaveLength(1);
    const state = await t.run(async (ctx) => {
      const config = await ctx.db
        .query('chatroom_agentDesiredConfigs')
        .withIndex('by_teamRoleKey', (q) =>
          q.eq('teamRoleKey', buildTeamRoleKey(chatroomId, 'duo', 'builder'))
        )
        .first();
      const row = await ctx.db
        .query('chatroom_agentRoleStatusReadModel')
        .withIndex('by_chatroom_role', (q) => q.eq('chatroomId', chatroomId).eq('role', 'builder'))
        .first();
      const runtime = config
        ? await ctx.db
            .query('chatroom_agentRuntimeStates')
            .withIndex('by_desiredConfig', (q) => q.eq('desiredConfigId', config._id))
            .first()
        : null;
      const command = await ctx.db
        .query('chatroom_machineCommandInbox')
        .withIndex('by_machine_status_deadline', (q) =>
          q.eq('machineId', 'offline-daemon').eq('status', 'pending')
        )
        .first();
      return { desiredState: runtime?.desiredState, status: row?.status, command };
    });

    expect(state.desiredState).toBe('running');
    expect(state.status).toBe('waiting');
    expect(state.command?.command).toMatchObject({
      type: 'agent.stop',
      chatroomId,
    });
  });
});
