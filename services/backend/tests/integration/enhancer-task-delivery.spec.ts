/**
 * Ephemeral task delivery — Integration Tests
 *
 * End-to-end getTaskDeliveryPrompt coverage for generic delivery when the
 * compatibility role name `enhancer` is configured or sends a task.
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { setupPlannerWorkspaceForSession, setupSoloWorkspaceForSession } from './harness-fixtures';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { t } from '../../test.setup';
import {
  enableEnhancerTeamAgent,
  addEnhancerToTeamRoles,
  joinParticipant,
} from '../helpers/integration';

async function enableEnhancer(
  sessionId: SessionId,
  chatroomId: Id<'chatroom_rooms'>,
  machineId: string
): Promise<void> {
  await enableEnhancerTeamAgent(sessionId, chatroomId, machineId);
}

async function setPlannerAsEntryPoint(chatroomId: Id<'chatroom_rooms'>): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.patch('chatroom_rooms', chatroomId, { teamEntryPoint: 'planner' });
  });
}
async function createPlannerTaskFromUserMessage(
  sessionId: SessionId,
  chatroomId: Id<'chatroom_rooms'>,
  content: string,
  opts?: { conversationMode?: 'chat' | 'code' | 'code:enhanced' }
): Promise<{ messageId: Id<'chatroom_messages'>; taskId: Id<'chatroom_tasks'> }> {
  const messageId = await t.mutation(api.messages.sendMessage, {
    sessionId,
    chatroomId,
    senderRole: 'user',
    content,
    targetRole: 'planner',
    type: 'message',
    ...(opts?.conversationMode !== undefined ? { conversationMode: opts.conversationMode } : {}),
  });

  // The canonical user-origin task is the one created by the user message send.
  const task = await t.run(async (ctx) => {
    return await ctx.db
      .query('chatroom_tasks')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
      .filter((q) => q.eq(q.field('sourceMessageId'), messageId))
      .first();
  });
  if (!task) throw new Error('missing user-origin task');

  return { messageId, taskId: task._id };
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

describe('getTaskDeliveryPrompt — generic ephemeral workflow', () => {
  test('planner user task uses ordinary user handoff despite enhanced compatibility mode', async () => {
    const { sessionId, chatroomId, machineId } =
      await setupPlannerWorkspaceForSession('enh-delivery-enabled');
    await setPlannerAsEntryPoint(chatroomId);
    await enableEnhancer(sessionId, chatroomId, machineId);
    await joinParticipant(sessionId, chatroomId, 'planner');

    const { messageId, taskId } = await createPlannerTaskFromUserMessage(
      sessionId,
      chatroomId,
      'Add dark mode to settings',
      { conversationMode: 'code:enhanced' }
    );

    const output = await getPlannerDeliveryPrompt(sessionId, chatroomId, taskId, messageId);

    expect(output).not.toContain('<handoff-enhancer>');
    expect(output).not.toContain('<enhancer-input>');
    expect(output).toContain('--next-role="user"');
  });

  test('solo user task uses the ordinary user handoff and base templates', async () => {
    const { sessionId, chatroomId, machineId } =
      await setupSoloWorkspaceForSession('enh-delivery-solo');
    await enableEnhancer(sessionId, chatroomId, machineId);
    await joinParticipant(sessionId, chatroomId, 'solo');

    const messageId = await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      senderRole: 'user',
      content: 'Add request-first planning to solo',
      targetRole: 'solo',
      type: 'message',
      conversationMode: 'code:enhanced',
    });
    const soloTask = await t.run(async (ctx) => {
      return await ctx.db
        .query('chatroom_tasks')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .filter((q) => q.eq(q.field('sourceMessageId'), messageId))
        .first();
    });
    const taskId = soloTask!._id;

    const { fullCliOutput } = await t.query(api.messages.getTaskDeliveryPrompt, {
      sessionId,
      chatroomId,
      role: 'solo',
      taskId,
      messageId,
      convexUrl: 'http://127.0.0.1:3210',
    });

    expect(fullCliOutput).not.toContain('<handoff-enhancer>');
    expect(fullCliOutput).not.toContain('<enhancer-input>');
    expect(fullCliOutput).toContain('--next-role="user"');

    const { prompt } = await t.query(api.messages.getRolePrompt, {
      sessionId,
      chatroomId,
      role: 'solo',
      convexUrl: 'http://127.0.0.1:3210',
    });
    // Role initialization is configuration-independent. The send-time task
    // envelope supplies enhanced guidance only for the specific user request.
    expect(prompt).not.toContain('When enhancement is enabled');
    expect(prompt).not.toContain('forward the request before planning');
  });

  test('planner user task ignores a stale enhancer snapshot for prompt ceremony', async () => {
    const { sessionId, chatroomId } = await setupPlannerWorkspaceForSession(
      'enh-delivery-snapshot-noconfig'
    );
    await joinParticipant(sessionId, chatroomId, 'planner');

    const { messageId, taskId } = await createPlannerTaskFromUserMessage(
      sessionId,
      chatroomId,
      'Task with stale snapshot'
    );

    await t.run(async (ctx) => {
      await ctx.db.patch('chatroom_tasks', taskId, { plannerEnhancerEnabled: true });
    });

    const output = await getPlannerDeliveryPrompt(sessionId, chatroomId, taskId, messageId);

    expect(output).not.toContain('<handoff-enhancer>');
    expect(output).not.toContain('<enhancer-input>');
    expect(output).toContain('--next-role="user"');
  });

  test('planner user task uses generic delivery when no ephemeral role is configured', async () => {
    const { sessionId, chatroomId } =
      await setupPlannerWorkspaceForSession('enh-delivery-disabled');
    await joinParticipant(sessionId, chatroomId, 'planner');

    const { messageId, taskId } = await createPlannerTaskFromUserMessage(
      sessionId,
      chatroomId,
      'Add dark mode to settings'
    );

    const output = await getPlannerDeliveryPrompt(sessionId, chatroomId, taskId, messageId);

    expect(output).not.toContain('<handoff-enhancer>');
    expect(output).not.toContain('<enhancer-input>');
    expect(output).toContain('--next-role="user"');
  });

  test('planner task from the compatibility role uses standard task intake and user handoff', async () => {
    const { sessionId, chatroomId, machineId } =
      await setupPlannerWorkspaceForSession('enh-delivery-feedback');
    await setPlannerAsEntryPoint(chatroomId);
    await enableEnhancer(sessionId, chatroomId, machineId);
    await addEnhancerToTeamRoles(chatroomId);
    await joinParticipant(sessionId, chatroomId, 'planner');

    const originUserMessageId = await t.run(async (ctx) => {
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
        plannerEnhancerEnabled: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        queuePosition: 1,
      });
      return msgId;
    });

    // Seed the same end state directly for the compatibility role.
    const _enhancerTaskId = await t.run(async (ctx) => {
      return ctx.db.insert('chatroom_tasks', {
        chatroomId,
        createdBy: 'planner',
        content: 'Check-in draft',
        status: 'in_progress',
        assignedTo: 'enhancer',
        originUserMessageId,
        sourceMessageId: originUserMessageId,
        plannerEnhancerEnabled: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        queuePosition: 1,
      });
    });

    await t.mutation(api.messages.handoff, {
      sessionId,
      chatroomId,
      senderRole: 'enhancer',
      targetRole: 'planner',
      content: '## Summary\nPlanning feedback for planner',
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

    expect(output).not.toContain('<enhancer-input>');
    expect(output).not.toContain('<handoff-enhancer>');
    expect(output).toContain('--next-role="user"');
    expect(output).toContain('Planning feedback for planner');
  });
});
