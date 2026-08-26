import { describe, expect, test } from 'vitest';
import { api } from '../../convex/_generated/api';
import { buildTeamRoleKey } from '../../convex/utils/teamRoleKey';
import { t } from '../../test.setup';
import { createDuoTeamChatroom, createTestSession, registerMachineWithDaemon } from '../helpers/integration';

describe('enhancer normal handoff completion', () => {
  test('delivery prompt uses standard handoff and creates no legacy job', async () => {
    const { sessionId } = await createTestSession('enhancer-normal-handoff');
    const chatroomId = await createDuoTeamChatroom(sessionId);
    const machineId = 'enhancer-normal-machine';
    await registerMachineWithDaemon(sessionId, machineId);
    await t.run(async (ctx) => {
      await ctx.db.patch(chatroomId, { teamRoles: ['planner', 'enhancer', 'builder'], teamEntryPoint: 'planner' });
      await ctx.db.insert('chatroom_teamAgentConfigs', { teamRoleKey: buildTeamRoleKey(chatroomId, 'duo', 'enhancer'), chatroomId, role: 'enhancer', type: 'remote', machineId, agentHarness: 'opencode', model: 'test-model', workingDir: '/workspace', enabled: true, desiredState: 'running', lifecycleRevision: 0, createdAt: Date.now(), updatedAt: Date.now() });
    });
    const messageId = await t.mutation(api.messages.sendMessage, { sessionId, chatroomId, senderRole: 'user', targetRole: 'planner', content: 'Design a feature', type: 'message' });
    await t.run(async (ctx) => ctx.db.insert('chatroom_tasks', { chatroomId, createdBy: 'user', content: 'Design a feature', status: 'in_progress', assignedTo: 'planner', sourceMessageId: messageId, plannerEnhancerEnabled: true, createdAt: Date.now(), updatedAt: Date.now(), queuePosition: 1 }));
    const queued = await t.mutation(api.messages.handoff, { sessionId, chatroomId, senderRole: 'planner', targetRole: 'enhancer', content: 'Produce a design' });
    expect(queued.success).toBe(true);
    const enhancerTask = await t.run((ctx) => ctx.db.query('chatroom_tasks').withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId)).filter((q) => q.eq(q.field('assignedTo'), 'enhancer')).first());
    expect(enhancerTask).toBeTruthy();
    const prompt = await t.query(api.messages.getTaskDeliveryPrompt, { sessionId, chatroomId, role: 'enhancer', taskId: enhancerTask!._id, messageId, convexUrl: 'http://127.0.0.1:3210' });
    expect(prompt.fullCliOutput).toContain('chatroom handoff');
    expect(prompt.fullCliOutput).not.toContain('enhancer complete');
    expect(await t.run((ctx) => ctx.db.query('chatroom_enhancerJobs').withIndex('by_chatroom_status', (q) => q.eq('chatroomId', chatroomId)).collect())).toHaveLength(0);
  });
});
