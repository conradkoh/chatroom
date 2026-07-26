/**
 * enhancer linear workflow — Integration Tests
 *
 * Full happy path: user message → enqueue → complete → planner feedback → builder handoff.
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
      createdAt: Date.now(),
      updatedAt: Date.now(),
      queuePosition: 1,
    });
    return id;
  });
  return msgId;
}

describe('enhancer linear workflow', () => {
  test('user task → enqueue → complete → planner feedback → builder handoff allowed', async () => {
    const { sessionId, chatroomId, machineId } = await setupWorkspaceForSession('enh-linear');
    await enableEnhancer(sessionId, chatroomId, machineId);
    await joinParticipant(sessionId, chatroomId, 'planner');
    await joinParticipant(sessionId, chatroomId, 'builder');

    const userMessageId = await createPlannerUserMessageAndTask(
      sessionId,
      chatroomId,
      'Build feature X'
    );

    const { jobId } = await t.mutation(api.web.enhancer.index.enqueueHandoff, {
      sessionId,
      chatroomId,
      senderRole: 'planner',
      targetRole: 'enhancer',
      content: '<user-message>Build feature X</user-message>',
    });

    // Planner tasks completed — no active planner work
    const activePlanner = await t.run(async (ctx) => {
      const tasks = await ctx.db
        .query('chatroom_tasks')
        .withIndex('by_chatroom_status', (q) =>
          q.eq('chatroomId', chatroomId).eq('status', 'in_progress')
        )
        .collect();
      return tasks.filter((t) => t.assignedTo === 'planner');
    });
    expect(activePlanner).toHaveLength(0);

    // Job stores originUserMessageId
    const job = await t.run(async (ctx) => ctx.db.get(jobId));
    expect(job!.originUserMessageId).toBe(userMessageId);

    // Claim and complete
    await t.mutation(api.daemon.enhancer.index.claimForSpawn, {
      sessionId,
      jobId,
      machineId,
    });
    await t.mutation(api.web.enhancer.index.complete, {
      sessionId,
      chatroomId,
      jobId,
      enhancedContent: '## Summary\nTighten scope',
    });

    // New planner pending task from enhancer feedback
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

    // Delivery prompt: builder primary, no enhancer check-in section
    const { fullCliOutput } = await t.query(api.messages.getTaskDeliveryPrompt, {
      sessionId,
      chatroomId,
      role: 'planner',
      taskId: feedbackTask!._id,
      messageId: feedbackTask!.sourceMessageId!,
      convexUrl: 'http://127.0.0.1:3210',
    });
    expect(fullCliOutput).toContain('next-role="builder"');
    expect(fullCliOutput).toContain('<enhancer-review>');
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

  test('second enhancer check-in succeeds for next slice after first job completes', async () => {
    const { sessionId, chatroomId, machineId } = await setupWorkspaceForSession('enh-multi');
    await enableEnhancer(sessionId, chatroomId, machineId);
    await joinParticipant(sessionId, chatroomId, 'planner');

    const userMessageId = await createPlannerUserMessageAndTask(
      sessionId,
      chatroomId,
      'Build multi-slice feature'
    );

    const { jobId: firstJobId } = await t.mutation(api.web.enhancer.index.enqueueHandoff, {
      sessionId,
      chatroomId,
      senderRole: 'planner',
      targetRole: 'enhancer',
      content: '<user-message>Slice 1</user-message>',
    });

    await t.mutation(api.daemon.enhancer.index.claimForSpawn, {
      sessionId,
      jobId: firstJobId,
      machineId,
    });
    await t.mutation(api.web.enhancer.index.complete, {
      sessionId,
      chatroomId,
      jobId: firstJobId,
      enhancedContent: '## Summary\nSlice 1 feedback',
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

    const { jobId: secondJobId } = await t.mutation(api.web.enhancer.index.enqueueHandoff, {
      sessionId,
      chatroomId,
      senderRole: 'planner',
      targetRole: 'enhancer',
      content: '<user-message>Slice 2</user-message>',
    });

    expect(secondJobId).toBeDefined();
    expect(secondJobId).not.toBe(firstJobId);

    const secondJob = await t.run(async (ctx) => ctx.db.get(secondJobId));
    expect(secondJob!.originUserMessageId).toBe(userMessageId);
  });
});
