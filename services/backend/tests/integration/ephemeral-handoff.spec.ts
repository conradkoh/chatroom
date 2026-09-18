/**
 * Generic task-delivery compatibility integration tests.
 *
 * Historical conversation-mode and ephemeral-agent configuration fields no
 * longer control task-delivery prompt ceremony.
 */

import { describe, expect, test } from 'vitest';

import { setupPlannerWorkspaceForSession } from './harness-fixtures';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { t } from '../../test.setup';
import {
  addEnhancerToTeamRoles,
  enableEnhancerTeamAgent,
  joinParticipant,
} from '../helpers/integration';

async function getTaskForMessage(
  chatroomId: Id<'chatroom_rooms'>,
  messageId: Id<'chatroom_messages'>
) {
  const task = await t.run(async (ctx) =>
    ctx.db
      .query('chatroom_tasks')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
      .filter((q) => q.eq(q.field('sourceMessageId'), messageId))
      .first()
  );
  if (!task) throw new Error('Task was not created for the user message');
  return task;
}

async function getPlannerDeliveryOutput(
  sessionId: string,
  chatroomId: Id<'chatroom_rooms'>,
  taskId: Id<'chatroom_tasks'>,
  messageId: Id<'chatroom_messages'>
) {
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

describe('generic task delivery compatibility', () => {
  test('compatibility mode uses ordinary delivery without a saved ephemeral config', async () => {
    const { sessionId, chatroomId } =
      await setupPlannerWorkspaceForSession('compatibility-no-config');
    await addEnhancerToTeamRoles(chatroomId);
    await joinParticipant(sessionId, chatroomId, 'planner');

    const messageId = await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      senderRole: 'user',
      content: 'Use compatibility planning',
      targetRole: 'planner',
      type: 'message',
      conversationMode: 'code:enhanced',
    });
    const messageIdTyped = messageId as Id<'chatroom_messages'>;
    const task = await getTaskForMessage(chatroomId, messageIdTyped);
    const output = await getPlannerDeliveryOutput(sessionId, chatroomId, task._id, messageIdTyped);

    expect(output).not.toContain('<handoff-enhancer>');
    expect(output).not.toContain('<enhancer-input>');
    expect(output).toContain('--next-role="user"');
  });

  test('chat send stays direct even when an ephemeral config exists', async () => {
    const { sessionId, chatroomId, machineId } =
      await setupPlannerWorkspaceForSession('chat-with-config');
    await enableEnhancerTeamAgent(sessionId, chatroomId, machineId);
    await joinParticipant(sessionId, chatroomId, 'planner');

    const messageId = await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      senderRole: 'user',
      content: 'Keep this conversational',
      targetRole: 'planner',
      type: 'message',
      conversationMode: 'chat',
    });
    const messageIdTyped = messageId as Id<'chatroom_messages'>;
    const task = await getTaskForMessage(chatroomId, messageIdTyped);
    const output = await getPlannerDeliveryOutput(sessionId, chatroomId, task._id, messageIdTyped);

    expect(output).not.toContain('<handoff-enhancer>');
    expect(output).toContain('<chat-mode>');
    expect(output).toContain('--next-role="user"');
  });

  test('planner handoff to configured ephemeral role uses the generic path in code mode', async () => {
    const { sessionId, chatroomId } = await setupPlannerWorkspaceForSession('handoff-ephemeral');
    await addEnhancerToTeamRoles(chatroomId);
    await joinParticipant(sessionId, chatroomId, 'planner');
    await joinParticipant(sessionId, chatroomId, 'builder');

    const messageId = await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      senderRole: 'user',
      content: 'Use normal code mode',
      targetRole: 'planner',
      type: 'message',
      conversationMode: 'code',
    });
    const task = await getTaskForMessage(chatroomId, messageId as Id<'chatroom_messages'>);
    await t.run(async (ctx) => {
      await ctx.db.patch('chatroom_tasks', task._id, { status: 'in_progress' });
    });

    const result = await t.mutation(api.messages.handoff, {
      sessionId,
      chatroomId,
      senderRole: 'planner',
      targetRole: 'enhancer',
      content: 'check-in',
    });

    expect(result.success).toBe(true);
    const targetTask = await t.run(async (ctx) => ctx.db.get(result.newTaskId!));
    expect(targetTask?.assignedTo).toBe('enhancer');
    expect(targetTask?.content).toBe('check-in');
  });
});
