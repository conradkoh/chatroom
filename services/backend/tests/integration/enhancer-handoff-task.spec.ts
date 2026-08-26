import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import { buildTeamRoleKey } from '../../convex/utils/teamRoleKey';
import { t } from '../../test.setup';
import {
  createDuoTeamChatroom,
  createTestSession,
  registerMachineWithDaemon,
} from '../helpers/integration';

async function setup(id: string) {
  const { sessionId } = await createTestSession(id);
  const chatroomId = await createDuoTeamChatroom(sessionId);
  const machineId = `enhancer-task-${id}`;
  await registerMachineWithDaemon(sessionId, machineId);
  await t.run(async (ctx) => {
    const room = await ctx.db.get(chatroomId);
    await ctx.db.patch(chatroomId, {
      teamRoles: ['planner', 'enhancer', 'builder'],
      teamEntryPoint: 'planner',
    });
    await ctx.db.insert('chatroom_teamAgentConfigs', {
      teamRoleKey: buildTeamRoleKey(chatroomId, 'duo', 'enhancer'),
      chatroomId,
      role: 'enhancer',
      type: 'remote',
      machineId,
      agentHarness: 'opencode',
      model: 'test-model',
      workingDir: '/workspace',
      enabled: true,
      desiredState: 'stopped',
      lifecycleRevision: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    return room;
  });
  return { sessionId, chatroomId };
}

describe('request-first enhancer handoff', () => {
  test('creates one enhancer task per origin and no legacy job', async () => {
    const { sessionId, chatroomId } = await setup('handoff-task');
    const origin = await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      senderRole: 'user',
      content: 'Build feature',
      targetRole: 'planner',
      type: 'message',
    });
    await t.run(async (ctx) =>
      ctx.db.insert('chatroom_tasks', {
        chatroomId,
        createdBy: 'user',
        content: 'Build feature',
        status: 'in_progress',
        assignedTo: 'planner',
        sourceMessageId: origin,
        plannerEnhancerEnabled: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        queuePosition: 1,
      })
    );
    const first = await t.mutation(api.messages.handoff, {
      sessionId,
      chatroomId,
      senderRole: 'planner',
      targetRole: 'enhancer',
      content: 'Review this',
    });
    expect(first.success).toBe(true);
    const tasks = await t.run((ctx) =>
      ctx.db
        .query('chatroom_tasks')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .collect()
    );
    expect(tasks.filter((task) => task.assignedTo === 'enhancer')).toHaveLength(1);
    expect(tasks.find((task) => task.assignedTo === 'enhancer')?.originUserMessageId).toBe(origin);
    expect(
      await t.run((ctx) =>
        ctx.db
          .query('chatroom_enhancerJobs')
          .withIndex('by_chatroom_status', (q) => q.eq('chatroomId', chatroomId))
          .collect()
      )
    ).toHaveLength(0);
    const second = await t.mutation(api.messages.handoff, {
      sessionId,
      chatroomId,
      senderRole: 'planner',
      targetRole: 'enhancer',
      content: 'Review this again',
    });
    expect(second.success).toBe(false);
    expect(second.error?.code).toBe('ENHANCER_ALREADY_USED');
  });
});
