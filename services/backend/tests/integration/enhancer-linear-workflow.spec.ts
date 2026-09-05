/**
 * enhancer delegation-loop workflow — Integration Tests
 *
 * Full happy path: user message → enqueue → complete → planner feedback → builder handoff.
 */

import { describe, expect, test } from 'vitest';

import { setupPlannerWorkspaceForSession } from './harness-fixtures';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { t } from '../../test.setup';
import { joinParticipant, enableEnhancerTeamAgent } from '../helpers/integration';

async function createPlannerUserMessageAndTask(
  sessionId: string,
  chatroomId: Id<'chatroom_rooms'>,
  content: string
): Promise<Id<'chatroom_messages'>> {
  const msgId = await t.run(async (ctx) => {
    const id = await ctx.db.insert('chatroom_messages', {
      chatroomId,
      senderRole: 'user',
      content,
      targetRole: 'planner',
      type: 'message',
    });
    await ctx.db.insert('chatroom_tasks', {
      chatroomId,
      createdBy: 'user',
      content,
      status: 'in_progress',
      assignedTo: 'planner',
      sourceMessageId: id,
      // Legacy-explicit enhancer request: the envelope derived by handoff
      // propagation stays code:enhanced so the enhancer loop is preserved.
      plannerEnhancerEnabled: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      queuePosition: 1,
    });
    return id;
  });
  return msgId;
}

describe('enhancer delegation-loop workflow', () => {
  test('user task → enqueue → complete → planner feedback → builder handoff allowed', async () => {
    const { sessionId, chatroomId, machineId } =
      await setupPlannerWorkspaceForSession('enh-linear');
    await enableEnhancerTeamAgent(sessionId, chatroomId, machineId);
    await joinParticipant(sessionId, chatroomId, 'planner');
    await joinParticipant(sessionId, chatroomId, 'builder');

    const userMessageId = await createPlannerUserMessageAndTask(
      sessionId,
      chatroomId,
      'Build feature X'
    );

    const enhancerHandoff = await t.mutation(api.messages.handoff, {
      sessionId,
      chatroomId,
      senderRole: 'planner',
      targetRole: 'enhancer',
      content: '<request>Build feature X</request>',
    });
    expect(enhancerHandoff.success).toBe(true);
    const enhancerJob = await t.run(async (ctx) =>
      ctx.db
        .query('chatroom_enhancerJobs')
        .withIndex('by_chatroom_status', (q) => q.eq('chatroomId', chatroomId))
        .first()
    );
    expect(enhancerJob).toBeDefined();
    await t.mutation(api.daemon.enhancer.index.claimForSpawn, {
      sessionId,
      jobId: enhancerJob!._id,
      machineId,
    });

    const enhancerTask = await t.run(async (ctx) => {
      const tasks = await ctx.db
        .query('chatroom_tasks')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .collect();
      return tasks.find((task) => task.assignedTo === 'enhancer');
    });
    expect(enhancerTask?.originUserMessageId).toBe(userMessageId);

    await t.mutation(api.messages.handoff, {
      sessionId,
      chatroomId,
      senderRole: 'enhancer',
      targetRole: 'planner',
      content: '## Summary\nTighten scope',
    });

    // New planner pending task from enhancer planning input
    const feedbackTask = await t.run(async (ctx) => {
      const pending = await ctx.db
        .query('chatroom_tasks')
        .withIndex('by_chatroom_status', (q) =>
          q.eq('chatroomId', chatroomId).eq('status', 'pending')
        )
        .collect();
      return pending.find((t) => t.assignedTo === 'planner');
    });
    expect(feedbackTask).toBeDefined();
    expect(feedbackTask!.content).toContain('Tighten scope');
    expect(feedbackTask!.sourceMessageId).toBeDefined();

    // Verify the source message exists and has correct senderRole
    const sourceMsg = await t.run(async (ctx) =>
      ctx.db.get('chatroom_messages', feedbackTask!.sourceMessageId!)
    );
    expect(sourceMsg).toBeDefined();
    expect(sourceMsg!.senderRole).toBe('enhancer');

    // Delivery prompt: builder primary, no repeated enhancer request section
    const { fullCliOutput } = await t.query(api.messages.getTaskDeliveryPrompt, {
      sessionId,
      chatroomId,
      role: 'planner',
      taskId: feedbackTask!._id,
      messageId: feedbackTask!.sourceMessageId!,
      convexUrl: 'http://127.0.0.1:3210',
    });
    expect(fullCliOutput).toContain('next-role="builder"');
    expect(fullCliOutput).toContain('<enhancer-input>');
    expect(fullCliOutput).not.toContain('<handoff-enhancer>');

    // Planner can hand off to builder
    const handoff = await t.mutation(api.messages.handoff, {
      sessionId,
      chatroomId,
      senderRole: 'planner',
      targetRole: 'builder',
      content: 'Delegation brief after feedback',
    });
    expect(handoff.success).toBe(true);
  });

  test('second enhancer pass is rejected for the same originating user message', async () => {
    const { sessionId, chatroomId, machineId } = await setupPlannerWorkspaceForSession('enh-multi');
    await enableEnhancerTeamAgent(sessionId, chatroomId, machineId);
    await joinParticipant(sessionId, chatroomId, 'planner');

    const userMessageId = await createPlannerUserMessageAndTask(
      sessionId,
      chatroomId,
      'Build multi-slice feature'
    );

    const enhancerHandoff = await t.mutation(api.messages.handoff, {
      sessionId,
      chatroomId,
      senderRole: 'planner',
      targetRole: 'enhancer',
      content: '<request>Build multi-slice feature</request>',
    });
    expect(enhancerHandoff.success).toBe(true);
    const enhancerJob = await t.run(async (ctx) =>
      ctx.db
        .query('chatroom_enhancerJobs')
        .withIndex('by_chatroom_status', (q) => q.eq('chatroomId', chatroomId))
        .first()
    );
    await t.mutation(api.daemon.enhancer.index.claimForSpawn, {
      sessionId,
      jobId: enhancerJob!._id,
      machineId,
    });
    await t.mutation(api.messages.handoff, {
      sessionId,
      chatroomId,
      senderRole: 'enhancer',
      targetRole: 'planner',
      content: '## Summary\nSlice 1 feedback',
    });

    // Simulate builder handback — planner has active task for slice 2
    await t.run(async (ctx) => {
      const builderMsgId = await ctx.db.insert('chatroom_messages', {
        chatroomId,
        senderRole: 'builder',
        content: 'Slice 1 complete',
        targetRole: 'planner',
        type: 'handoff',
        taskOriginMessageId: userMessageId,
      });
      await ctx.db.insert('chatroom_tasks', {
        chatroomId,
        createdBy: 'builder',
        content: 'Slice 1 complete — ready for slice 2',
        status: 'in_progress',
        assignedTo: 'planner',
        sourceMessageId: builderMsgId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        queuePosition: 2,
      });
    });

    const second = await t.mutation(api.messages.handoff, {
      sessionId,
      chatroomId,
      senderRole: 'planner',
      targetRole: 'enhancer',
      content: '<request>Continue the user request</request>',
    });
    expect(second.success).toBe(false);
    expect(second.error?.code).toBe('ENHANCER_ALREADY_USED');
  });
});
