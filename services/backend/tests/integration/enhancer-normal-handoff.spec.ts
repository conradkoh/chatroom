import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import { t } from '../../test.setup';
import {
  createDuoTeamChatroom,
  createTestSession,
  joinParticipant,
  registerMachineWithDaemon,
} from '../helpers/integration';

describe('enhancer normal handoff completion', () => {
  test('delivery prompt uses standard handoff and creates a linked job', async () => {
    const { sessionId } = await createTestSession('enhancer-normal-handoff');
    const chatroomId = await createDuoTeamChatroom(sessionId);
    const machineId = 'enhancer-normal-machine';
    await registerMachineWithDaemon(sessionId, machineId);
    await t.mutation(api.workspaces.registerWorkspace, {
      sessionId,
      chatroomId,
      machineId,
      workingDir: '/workspace',
      hostname: 'test-host',
      registeredBy: 'planner',
    });
    const workspace = await t.run((ctx) =>
      ctx.db
        .query('chatroom_workspaces')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .first()
    );
    await t.mutation(api.agents.saveConfig, {
      sessionId,
      chatroomId,
      workspaceId: workspace!._id,
      role: 'enhancer',
      machineId,
      agentHarness: 'opencode',
      model: 'test-model',
      workingDir: '/workspace',
    });
    const messageId = await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      senderRole: 'user',
      targetRole: 'planner',
      content: 'Design a feature',
      type: 'message',
    });
    await t.run(async (ctx) =>
      ctx.db.insert('chatroom_tasks', {
        chatroomId,
        createdBy: 'user',
        content: 'Design a feature',
        status: 'in_progress',
        assignedTo: 'planner',
        sourceMessageId: messageId,
        plannerEnhancerEnabled: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        queuePosition: 1,
      })
    );
    const queued = await t.mutation(api.messages.handoff, {
      sessionId,
      chatroomId,
      senderRole: 'planner',
      targetRole: 'enhancer',
      content: 'Produce a design',
    });
    expect(queued.success).toBe(true);
    const enhancerTask = await t.run((ctx) =>
      ctx.db
        .query('chatroom_tasks')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .filter((q) => q.eq(q.field('assignedTo'), 'enhancer'))
        .first()
    );
    expect(enhancerTask).toBeTruthy();
    const prompt = await t.query(api.messages.getTaskDeliveryPrompt, {
      sessionId,
      chatroomId,
      role: 'enhancer',
      taskId: enhancerTask!._id,
      messageId,
      convexUrl: 'http://127.0.0.1:3210',
    });
    expect(prompt.fullCliOutput).toContain('chatroom handoff');
    expect(prompt.fullCliOutput).not.toContain('enhancer complete');
    expect(
      await t.run((ctx) =>
        ctx.db
          .query('chatroom_enhancerJobs')
          .withIndex('by_chatroom_status', (q) => q.eq('chatroomId', chatroomId))
          .collect()
      )
    ).toHaveLength(1);
  });

  test('enhancer handoff completes running job and entry point stays waiting after heartbeat', async () => {
    const { sessionId } = await createTestSession('enhancer-handoff-completes-job');
    const chatroomId = await createDuoTeamChatroom(sessionId);
    const machineId = 'enhancer-handoff-complete-machine';
    await registerMachineWithDaemon(sessionId, machineId);
    await joinParticipant(sessionId, chatroomId, 'planner');
    await t.mutation(api.workspaces.registerWorkspace, {
      sessionId,
      chatroomId,
      machineId,
      workingDir: '/workspace',
      hostname: 'test-host',
      registeredBy: 'planner',
    });
    const workspace = await t.run((ctx) =>
      ctx.db
        .query('chatroom_workspaces')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .first()
    );
    await t.mutation(api.agents.saveConfig, {
      sessionId,
      chatroomId,
      workspaceId: workspace!._id,
      role: 'enhancer',
      machineId,
      agentHarness: 'opencode',
      model: 'test-model',
      workingDir: '/workspace',
    });
    const messageId = await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      senderRole: 'user',
      targetRole: 'planner',
      content: 'Design a feature',
      type: 'message',
    });
    await t.run(async (ctx) =>
      ctx.db.insert('chatroom_tasks', {
        chatroomId,
        createdBy: 'user',
        content: 'Design a feature',
        status: 'in_progress',
        assignedTo: 'planner',
        sourceMessageId: messageId,
        plannerEnhancerEnabled: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        queuePosition: 1,
      })
    );
    await t.mutation(api.messages.handoff, {
      sessionId,
      chatroomId,
      senderRole: 'planner',
      targetRole: 'enhancer',
      content: 'Produce a design',
    });
    const enhancerJob = await t.run((ctx) =>
      ctx.db
        .query('chatroom_enhancerJobs')
        .withIndex('by_chatroom_status', (q) => q.eq('chatroomId', chatroomId))
        .first()
    );
    expect(enhancerJob?.status).toBe('pending');
    await t.mutation(api.daemon.enhancer.index.claimForSpawn, {
      sessionId,
      jobId: enhancerJob!._id,
      machineId,
    });
    const runningJob = await t.run((ctx) => ctx.db.get('chatroom_enhancerJobs', enhancerJob!._id));
    expect(runningJob?.status).toBe('running');

    const delivery = await t.mutation(api.messages.handoff, {
      sessionId,
      chatroomId,
      senderRole: 'enhancer',
      targetRole: 'planner',
      content: '## Summary\nDesign input delivered via handoff',
    });
    expect(delivery.success).toBe(true);

    const completedJob = await t.run((ctx) =>
      ctx.db.get('chatroom_enhancerJobs', enhancerJob!._id)
    );
    expect(completedJob?.status).toBe('complete');
    expect(completedJob?.enhancedContent).toContain('Design input delivered');

    const enhancerStatus = await t.run((ctx) =>
      ctx.db
        .query('chatroom_agentRoleStatusReadModel')
        .withIndex('by_chatroom_role', (q) => q.eq('chatroomId', chatroomId).eq('role', 'enhancer'))
        .first()
    );
    expect(enhancerStatus).toBeNull();

    await t.mutation(api.participants.join, {
      sessionId,
      chatroomId,
      role: 'planner',
      action: 'get-next-task:started',
    });
    const planner = await t.query(api.participants.getByRole, {
      sessionId,
      chatroomId,
      role: 'planner',
    });
    expect(planner?.lastSeenAction).toBe('get-next-task:started');
  });
});
