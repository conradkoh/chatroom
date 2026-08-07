/**
 * Enhancer disabled — handoff behaviour should be normal.
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { t } from '../../test.setup';
import {
  joinParticipant,
  createTestSession,
  createPlannerBuilderDuoChatroom,
  registerMachineWithDaemon,
} from '../helpers/integration';
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

async function setupPlannerEntryWorkspace(prefix: string) {
  const { sessionId } = await createTestSession(`${prefix}-session`);
  const chatroomId = await createPlannerBuilderDuoChatroom(sessionId);
  const machineId = `${prefix}-machine`;
  await registerMachineWithDaemon(sessionId, machineId);
  await t.mutation(api.workspaces.registerWorkspace, {
    sessionId,
    chatroomId,
    machineId,
    workingDir: '/home/test/repo',
    hostname: 'test-host',
    registeredBy: 'builder',
  });
  await t.mutation(api.chatrooms.recordChatroomObservation, {
    sessionId,
    chatroomId,
  });
  return { sessionId, chatroomId, machineId };
}

describe('enhancer disabled handoff', () => {
  test('planner handoff to enhancer rejected when enhancer disabled', async () => {
    const { sessionId, chatroomId } = await setupWorkspaceForSession('enh-off-reject');
    await joinParticipant(sessionId, chatroomId, 'planner');
    await joinParticipant(sessionId, chatroomId, 'builder');

    await t.run(async (ctx) => {
      const msgId = await ctx.db.insert('chatroom_messages', {
        chatroomId,
        senderRole: 'user',
        content: 'Build feature X',
        targetRole: 'planner',
        type: 'message',
      });
      await ctx.db.insert('chatroom_tasks', {
        chatroomId,
        createdBy: 'user',
        content: 'Build feature X',
        status: 'in_progress',
        assignedTo: 'planner',
        sourceMessageId: msgId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        queuePosition: 1,
      });
    });

    const result = await t.mutation(api.messages.handoff, {
      sessionId,
      chatroomId,
      senderRole: 'planner',
      targetRole: 'enhancer',
      content: 'check-in',
    });
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('ENHANCER_NOT_ENABLED');
  });

  test('delivery omits enhancer and includes disabled guidance after disableConfig', async () => {
    const { sessionId, chatroomId, machineId } =
      await setupWorkspaceForSession('enh-disabled-delivery');
    await enableEnhancer(sessionId, chatroomId, machineId);
    await t.mutation(api.web.enhancer.index.upsertConfig, {
      sessionId,
      chatroomId,
      enabled: false,
      targetId: 'handoff:planner-to-builder',
      agentHarness: 'opencode',
      model: 'anthropic/claude-opus-4',
      machineId,
    });
    await joinParticipant(sessionId, chatroomId, 'planner');

    const messageId = await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      senderRole: 'user',
      content: 'Test task',
      targetRole: 'planner',
      type: 'message',
    });
    const tasks = await t.run(async (ctx) =>
      ctx.db
        .query('chatroom_tasks')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .order('desc')
        .first()
    );
    const taskId = tasks!._id;

    const { fullCliOutput } = await t.query(api.messages.getTaskDeliveryPrompt, {
      sessionId,
      chatroomId,
      role: 'planner',
      taskId,
      messageId,
      convexUrl: 'http://127.0.0.1:3210',
    });
    expect(fullCliOutput).not.toContain('<handoff-enhancer>');
    expect(fullCliOutput).toContain('<handoff-enhancer-disabled>');
    expect(fullCliOutput).not.toContain('--next-role="enhancer"');
  });

  test('role prompt omits enhancer workflow when config disabled', async () => {
    const { sessionId, chatroomId, machineId } =
      await setupWorkspaceForSession('enh-disabled-roleprompt');
    await enableEnhancer(sessionId, chatroomId, machineId);
    await t.mutation(api.web.enhancer.index.upsertConfig, {
      sessionId,
      chatroomId,
      enabled: false,
      targetId: 'handoff:planner-to-builder',
      agentHarness: 'opencode',
      model: 'anthropic/claude-opus-4',
      machineId,
    });
    await joinParticipant(sessionId, chatroomId, 'planner');

    const { prompt } = await t.query(api.messages.getRolePrompt, {
      sessionId,
      chatroomId,
      role: 'planner',
    });
    expect(prompt).not.toContain('handoff-enhancer');
    expect(prompt).not.toContain('When enhancement is enabled');
  });
  test('preserves enhancer snapshot when enabled at send then disabled globally', async () => {
    const { sessionId, chatroomId, machineId } =
      await setupPlannerEntryWorkspace('enh-snapshot-preserve');
    await enableEnhancer(sessionId, chatroomId, machineId);
    await joinParticipant(sessionId, chatroomId, 'planner');
    await joinParticipant(sessionId, chatroomId, 'builder');

    const messageId = await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      senderRole: 'user',
      content: 'Send enhanced delegation to builder',
      targetRole: 'planner',
      type: 'message',
    });

    await t.mutation(api.web.enhancer.index.disableConfig, {
      sessionId,
      chatroomId,
    });

    const task = await t.run(async (ctx) =>
      ctx.db
        .query('chatroom_tasks')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .order('desc')
        .first()
    );
    expect(task?.plannerEnhancerEnabled).toBe(true);
    expect(task?.assignedTo).toBe('planner');

    await t.run(async (ctx) => {
      await ctx.db.patch('chatroom_tasks', task!._id, { status: 'in_progress' });
    });

    const handoffResult = await t.mutation(api.messages.handoff, {
      sessionId,
      chatroomId,
      senderRole: 'planner',
      targetRole: 'enhancer',
      content: 'check-in',
    });
    if (!handoffResult.success) {
      throw new Error(`handoff failed: ${JSON.stringify(handoffResult.error)}`);
    }
    expect(handoffResult.success).toBe(true);

    const { fullCliOutput } = await t.query(api.messages.getTaskDeliveryPrompt, {
      sessionId,
      chatroomId,
      role: 'planner',
      taskId: task!._id,
      messageId,
      convexUrl: 'http://127.0.0.1:3210',
    });
    expect(fullCliOutput).toContain('<handoff-enhancer>');
    expect(fullCliOutput).not.toContain('<handoff-enhancer-disabled>');
    expect(fullCliOutput).toContain('--next-role="enhancer"');
  });

  test('planner handoff to builder succeeds when enhancer disabled', async () => {
    const { sessionId, chatroomId } = await setupWorkspaceForSession('enh-off-handoff');
    await joinParticipant(sessionId, chatroomId, 'planner');
    await joinParticipant(sessionId, chatroomId, 'builder');

    // Create a planner task so the handoff can complete it
    await t.run(async (ctx) => {
      const msgId = await ctx.db.insert('chatroom_messages', {
        chatroomId,
        senderRole: 'user',
        content: 'Build feature X',
        targetRole: 'planner',
        type: 'message',
      });
      await ctx.db.insert('chatroom_tasks', {
        chatroomId,
        createdBy: 'user',
        content: 'Build feature X',
        status: 'in_progress',
        assignedTo: 'planner',
        sourceMessageId: msgId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        queuePosition: 1,
      });
    });

    const result = await t.mutation(api.messages.handoff, {
      sessionId,
      chatroomId,
      senderRole: 'planner',
      targetRole: 'builder',
      content: 'Direct delegation',
    });
    expect(result.success).toBe(true);
  });
});
