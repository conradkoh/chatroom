import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { projectAgentRoleStatusReadModel } from './project-agent-role-status-read-model';
import { recordLastSentLaunchRequest } from './record-last-sent-launch-request';
import { api } from '../../../../convex/_generated/api';
import type { Id } from '../../../../convex/_generated/dataModel';
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
      const user = await ctx.db.query('users').first();
      await recordLastSentLaunchRequest(ctx, {
        requestId: 'request-stop-reset-request',
        commandId: 'request-stop-reset-command',
        chatroomId,
        teamStructureId: 'duo@1',
        role: 'builder',
        agentType: 'remote',
        machineId: 'offline-daemon',
        agentHarness: 'opencode',
        model: 'test-model',
        workingDir: '/tmp/test',
        reason: 'user.start',
        wantResume: false,
        requestedBy: user!._id,
        requestedAt: Date.now(),
      });
      await projectAgentRoleStatusReadModel(ctx, {
        chatroomId,
        role: 'builder',
        event: { status: 'waiting' },
        sourceMachineId: 'offline-daemon',
      });
    });

    const result = await t.mutation(api.agents.requestStopAll, {
      sessionId,
      chatroomId: chatroomId as Id<'chatroom_rooms'>,
    });

    expect(result.commandIds).toHaveLength(1);
    const state = await t.run(async (ctx) => {
      const row = await ctx.db
        .query('chatroom_agentRoleStatusReadModel')
        .withIndex('by_chatroom_role', (q) => q.eq('chatroomId', chatroomId).eq('role', 'builder'))
        .first();
      const command = await ctx.db
        .query('chatroom_machineCommandInbox')
        .withIndex('by_machine_status_deadline', (q) =>
          q.eq('machineId', 'offline-daemon').eq('status', 'pending')
        )
        .first();
      return { status: row?.status, command };
    });

    expect(state.status).toBe('waiting');
    expect(state.command?.command).toMatchObject({
      type: 'agent.stop',
      chatroomId,
    });
  });
});
