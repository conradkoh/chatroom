/**
 * Tests for promote-queued-message use case.
 * Verifies that queued messages are correctly promoted to chatroom_messages.
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { api } from '../../../../convex/_generated/api';
import type { Id } from '../../../../convex/_generated/dataModel';
import { t } from '../../../../test.setup';
import { promoteQueuedMessage } from './promote-queued-message';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createTestSession(id: string) {
  const login = await t.mutation(api.auth.loginAnon, { sessionId: id as SessionId });
  expect(login.success).toBe(true);
  return { sessionId: id as SessionId, userId: login.userId as Id<'users'> };
}

async function createChatroom(sessionId: SessionId): Promise<Id<'chatroom_rooms'>> {
  return await t.mutation(api.chatrooms.create, {
    sessionId,
    teamId: 'pair',
    teamName: 'Pair Team',
    teamRoles: ['builder', 'reviewer'],
    teamEntryPoint: 'builder',
  });
}

async function createQueuedTaskWithQueuedMessage(
  chatroomId: Id<'chatroom_rooms'>
): Promise<{
  taskId: Id<'chatroom_tasks'>;
  queuedMessageId: Id<'chatroom_messageQueue'>;
}> {
  return await t.run(async (ctx) => {
    const now = Date.now();

    // Create the queued task first (without queuedMessageId)
    const taskId = await ctx.db.insert('chatroom_tasks', {
      chatroomId,
      createdBy: 'user',
      content: 'queued message content',
      status: 'queued',
      origin: 'chat',
      createdAt: now,
      updatedAt: now,
      queuePosition: 0,
    });

    // Now create the queued message with the proper taskId
    const queuedMessageId = await ctx.db.insert('chatroom_messageQueue', {
      chatroomId,
      senderRole: 'user',
      targetRole: 'builder',
      content: 'queued message content',
      type: 'message',
      taskId,
    });

    // Update the task with queuedMessageId
    await ctx.db.patch('chatroom_tasks', taskId, { queuedMessageId });

    return { taskId, queuedMessageId };
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('promoteQueuedMessage', () => {
  test('copies queue record to chatroom_messages when task has queuedMessageId', async () => {
    const { sessionId } = await createTestSession('promote-msg-1');
    const chatroomId = await createChatroom(sessionId);

    // Create queued task with queued message
    const { taskId } = await createQueuedTaskWithQueuedMessage(chatroomId);

    // Promote the message
    const messageId = await t.run(async (ctx) => {
      return await promoteQueuedMessage(ctx, taskId);
    });

    // Verify a chatroom_messages record was created
    expect(messageId).toBeDefined();
    expect(messageId).not.toBeNull();

    const message = await t.run(async (ctx) => {
      return await ctx.db.get('chatroom_messages', messageId as Id<'chatroom_messages'>);
    });

    expect(message).toBeDefined();
    expect(message?.content).toBe('queued message content');
    expect(message?.senderRole).toBe('user');
    expect(message?.targetRole).toBe('builder');
    expect(message?.taskId).toBe(taskId);
  });

  test('sets task.sourceMessageId to new message ID after promotion', async () => {
    const { sessionId } = await createTestSession('promote-msg-2');
    const chatroomId = await createChatroom(sessionId);

    const { taskId } = await createQueuedTaskWithQueuedMessage(chatroomId);

    // Promote the message
    const messageId = await t.run(async (ctx) => {
      return await promoteQueuedMessage(ctx, taskId);
    });

    // Verify task.sourceMessageId is set
    const task = await t.run(async (ctx) => {
      return await ctx.db.get('chatroom_tasks', taskId);
    });

    expect(task?.sourceMessageId).toBe(messageId);
  });

  test('clears task.queuedMessageId after promotion', async () => {
    const { sessionId } = await createTestSession('promote-msg-3');
    const chatroomId = await createChatroom(sessionId);

    const { taskId } = await createQueuedTaskWithQueuedMessage(chatroomId);

    // Promote the message
    await t.run(async (ctx) => {
      return await promoteQueuedMessage(ctx, taskId);
    });

    // Verify task.queuedMessageId is cleared
    const task = await t.run(async (ctx) => {
      return await ctx.db.get('chatroom_tasks', taskId);
    });

    expect(task?.queuedMessageId).toBeUndefined();
  });

  test('is idempotent: if task already has sourceMessageId, skips copy', async () => {
    const { sessionId } = await createTestSession('promote-msg-4');
    const chatroomId = await createChatroom(sessionId);

    const { taskId } = await createQueuedTaskWithQueuedMessage(chatroomId);

    // First promotion
    const firstMessageId = await t.run(async (ctx) => {
      return await promoteQueuedMessage(ctx, taskId);
    });

    // Second promotion (should return same ID, not create new message)
    const secondMessageId = await t.run(async (ctx) => {
      return await promoteQueuedMessage(ctx, taskId);
    });

    expect(secondMessageId).toBe(firstMessageId);

    // Verify only one message was created
    const messages = await t.run(async (ctx) => {
      return await ctx.db
        .query('chatroom_messages')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .collect();
    });

    const messagesWithContent = messages.filter((m) => m.content === 'queued message content');
    expect(messagesWithContent.length).toBe(1);
  });

  test('copies classification to chatroom_messages if set on queue record', async () => {
    const { sessionId } = await createTestSession('promote-msg-5');
    const chatroomId = await createChatroom(sessionId);

    // Create queued task with classified queue message
    const { taskId, queuedMessageId } = await createQueuedTaskWithQueuedMessage(chatroomId);

    // Add classification to the queued message
    await t.run(async (ctx) => {
      await ctx.db.patch('chatroom_messageQueue', queuedMessageId, {
        classification: 'question',
        featureTitle: 'Test Feature',
        featureDescription: 'Test description',
        featureTechSpecs: 'Test specs',
      });
    });

    // Promote the message
    const messageId = await t.run(async (ctx) => {
      return await promoteQueuedMessage(ctx, taskId);
    });

    // Verify classification was copied
    const message = await t.run(async (ctx) => {
      return await ctx.db.get('chatroom_messages', messageId as Id<'chatroom_messages'>);
    });

    expect(message?.classification).toBe('question');
    expect(message?.featureTitle).toBe('Test Feature');
    expect(message?.featureDescription).toBe('Test description');
    expect(message?.featureTechSpecs).toBe('Test specs');
  });
});
