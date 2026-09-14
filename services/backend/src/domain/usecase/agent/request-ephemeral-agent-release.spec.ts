import { describe, expect, test } from 'vitest';

import { requestEphemeralAgentRelease } from './request-ephemeral-agent-release';
import { api } from '../../../../convex/_generated/api';
import { t } from '../../../../test.setup';

describe('requestEphemeralAgentRelease', () => {
  test('creates a running-capacity release for an enhancer task', async () => {
    const sessionId = 'ephemeral-release' as any;
    await t.mutation(api.auth.loginAnon, { sessionId });
    const chatroomId = await t.mutation(api.chatrooms.create, {
      sessionId,
      teamId: 'duo',
      teamName: 'Duo',
      teamRoles: ['planner', 'enhancer', 'builder'],
      teamEntryPoint: 'planner',
    });
    const machineId = 'ephemeral-machine';
    await t.mutation(api.machines.register, {
      sessionId,
      machineId,
      hostname: 'test',
      os: 'linux',
      availableHarnesses: ['opencode'],
    });
    await t.mutation(api.participants.join, {
      sessionId,
      chatroomId,
      role: 'enhancer',
    });
    await t.run(async (ctx) => {
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
      await requestEphemeralAgentRelease(ctx, (await ctx.db.get(taskId)) as any);
    });
    const participant = await t.run((ctx) =>
      ctx.db
        .query('chatroom_participants')
        .withIndex('by_chatroom_and_role', (q) =>
          q.eq('chatroomId', chatroomId).eq('role', 'enhancer')
        )
        .first()
    );
    expect(participant?.lastSeenAction).toBe('exited');
  });
});
