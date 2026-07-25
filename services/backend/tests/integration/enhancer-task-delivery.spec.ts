/**
 * Enhancer task delivery — Integration Tests
 *
 * End-to-end getTaskDeliveryPrompt with enhancer enabled vs disabled,
 * and enhancer feedback delivery shape.
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { t } from '../../test.setup';
import { joinParticipant } from '../helpers/integration';
import { setupWorkspaceForSession } from './direct-harness/fixtures';

async function enableEnhancer(
  sessionId: SessionId,
  chatroomId: Id<'chatroom_rooms'>,
  machineId: string
): Promise<void> {
  await t.mutation(api.web.enhancer.index.upsertConfig, {
    sessionId,
    chatroomId,
    enabled: true,
    targetId: 'handoff:planner-to-builder',
    agentHarness: 'opencode',
    model: 'anthropic/claude-opus-4',
    machineId,
  });
}

async function createPlannerTaskFromUserMessage(
  sessionId: SessionId,
  chatroomId: Id<'chatroom_rooms'>,
  content: string
): Promise<{ messageId: Id<'chatroom_messages'>; taskId: Id<'chatroom_tasks'> }> {
  const messageId = await t.mutation(api.messages.sendMessage, {
    sessionId,
    chatroomId,
    senderRole: 'user',
    content,
    targetRole: 'planner',
    type: 'message',
  });

  const { taskId } = await t.mutation(api.tasks.createTask, {
    sessionId,
    chatroomId,
    content,
    createdBy: 'user',
    sourceMessageId: messageId,
  });

  return { messageId, taskId };
}

async function getPlannerDeliveryPrompt(
  sessionId: SessionId,
  chatroomId: Id<'chatroom_rooms'>,
  taskId: Id<'chatroom_tasks'>,
  messageId: Id<'chatroom_messages'>
): Promise<string> {
  const { fullCliOutput } = await t.query(api.messages.getTaskDeliveryPrompt, {
    sessionId,
    chatroomId,
    role: 'planner',
    taskId,
    messageId,
    convexUrl: 'http://127.0.0.1:3210',
  });
  return fullCliOutput;
}

describe('getTaskDeliveryPrompt — enhancer enabled vs disabled', () => {
  test('planner user task includes enhancer guidance and enhancer as primary handoff', async () => {
    const { sessionId, chatroomId, machineId } =
      await setupWorkspaceForSession('enh-delivery-enabled');
    await enableEnhancer(sessionId, chatroomId, machineId);
    await joinParticipant(sessionId, chatroomId, 'planner');

    const { messageId, taskId } = await createPlannerTaskFromUserMessage(
      sessionId,
      chatroomId,
      'Add dark mode to settings'
    );

    const output = await getPlannerDeliveryPrompt(sessionId, chatroomId, taskId, messageId);

    expect(output).toContain('<handoff-enhancer>');
    expect(output).toContain('enhancement enabled for this user instruction');
    expect(output).toContain('user → planner → enhancer → planner → builder → user');
    expect(output).toContain('--next-role="enhancer"');
    expect(output).toContain('Handoff to `enhancer`');
    expect(output).toContain('**enhancer**');
  });

  test('planner user task omits enhancer guidance when config disabled', async () => {
    const { sessionId, chatroomId } = await setupWorkspaceForSession('enh-delivery-disabled');
    await joinParticipant(sessionId, chatroomId, 'planner');

    const { messageId, taskId } = await createPlannerTaskFromUserMessage(
      sessionId,
      chatroomId,
      'Add dark mode to settings'
    );

    const output = await getPlannerDeliveryPrompt(sessionId, chatroomId, taskId, messageId);

    expect(output).not.toContain('<handoff-enhancer>');
    expect(output).not.toContain('Handoff to `enhancer`');
    expect(output).not.toContain('**enhancer**');
    expect(output).toContain('--next-role="user"');
  });

  test('planner enhancer feedback task uses review guidance and builder as primary handoff', async () => {
    const { sessionId, chatroomId, machineId } =
      await setupWorkspaceForSession('enh-delivery-feedback');
    await enableEnhancer(sessionId, chatroomId, machineId);
    await joinParticipant(sessionId, chatroomId, 'planner');

    await t.run(async (ctx) => {
      const msgId = await ctx.db.insert('chatroom_messages', {
        chatroomId,
        senderRole: 'user',
        content: 'Delivery task test',
        targetRole: 'planner',
        type: 'message',
      });
      await ctx.db.insert('chatroom_tasks', {
        chatroomId,
        createdBy: 'user',
        content: 'Delivery task test',
        status: 'in_progress',
        assignedTo: 'planner',
        sourceMessageId: msgId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        queuePosition: 1,
      });
    });

    const { jobId } = await t.mutation(api.web.enhancer.index.enqueueHandoff, {
      sessionId,
      chatroomId,
      senderRole: 'planner',
      targetRole: 'enhancer',
      content: 'Check-in draft',
    });

    await t.mutation(api.daemon.enhancer.index.claimForSpawn, {
      sessionId,
      jobId,
      machineId,
    });

    await t.mutation(api.web.enhancer.index.complete, {
      sessionId,
      chatroomId,
      jobId,
      enhancedContent: '## Summary\nPlanning feedback for planner',
    });

    const tasks = await t.run(async (ctx) =>
      ctx.db
        .query('chatroom_tasks')
        .withIndex('by_chatroom_status', (q) =>
          q.eq('chatroomId', chatroomId).eq('status', 'pending')
        )
        .collect()
    );
    const plannerTask = tasks.find((task) => task.assignedTo === 'planner');
    expect(plannerTask).toBeDefined();

    const handoffMessages = await t.run(async (ctx) =>
      ctx.db
        .query('chatroom_messages')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .filter((q) => q.eq(q.field('type'), 'handoff'))
        .collect()
    );
    const feedbackMessage = handoffMessages.find((m) => m.senderRole === 'enhancer');
    expect(feedbackMessage).toBeDefined();

    const output = await getPlannerDeliveryPrompt(
      sessionId,
      chatroomId,
      plannerTask!._id,
      feedbackMessage!._id
    );

    expect(output).toContain('<enhancer-review>');
    expect(output).not.toContain('<handoff-enhancer>');
    expect(output).not.toContain('Handoff to `enhancer`');
    expect(output).toContain('--next-role="builder"');
    expect(output).toContain('Planning feedback for planner');
  });
});
