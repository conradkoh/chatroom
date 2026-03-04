/**
 * Tests for _sendMessageHandler — verifies queued user message routing.
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { t } from '../test.setup';

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

async function seedActiveTask(chatroomId: Id<'chatroom_rooms'>) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    return await ctx.db.insert('chatroom_tasks', {
      chatroomId,
      createdBy: 'user',
      content: 'active task',
      status: 'in_progress',
      origin: 'chat',
      createdAt: now,
      updatedAt: now,
      queuePosition: 0,
    });
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('_sendMessageHandler — queued user message routing', () => {
  test('first user message (no active tasks) → stored in chatroom_messages, task.sourceMessageId set', async () => {
    const { sessionId } = await createTestSession('msg-route-1');
    const chatroomId = await createChatroom(sessionId);

    // Send first user message (no active tasks)
    const messageId = await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      senderRole: 'user',
      content: 'first message',
      type: 'message',
    });

    // Verify message is in chatroom_messages
    const message = await t.run(async (ctx) => {
      return await ctx.db.get('chatroom_messages', messageId as Id<'chatroom_messages'>);
    });
    expect(message).toBeDefined();
    expect(message?.content).toBe('first message');

    // Verify task was created with sourceMessageId
    const task = await t.run(async (ctx) => {
      return await ctx.db
        .query('chatroom_tasks')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .first();
    });
    expect(task).toBeDefined();
    expect(task?.status).toBe('pending');
    expect(task?.sourceMessageId).toBe(messageId);
    expect(task?.queuedMessageId).toBeUndefined();
  });

  test('second user message (active task exists) → stored in chatroom_messageQueue, task.queuedMessageId set', async () => {
    const { sessionId } = await createTestSession('msg-route-2');
    const chatroomId = await createChatroom(sessionId);

    // Seed an active task
    await seedActiveTask(chatroomId);

    // Send second user message
    const returnedId = await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      senderRole: 'user',
      content: 'second message',
      type: 'message',
    });

    // Verify message IS in chatroom_messageQueue
    const queuedMessage = await t.run(async (ctx) => {
      return await ctx.db.get('chatroom_messageQueue', returnedId as Id<'chatroom_messageQueue'>);
    });
    expect(queuedMessage).toBeDefined();
    expect(queuedMessage?.content).toBe('second message');

    // Verify message is NOT in chatroom_messages (should be queued)
    const messagesInRegularTable = await t.run(async (ctx) => {
      return await ctx.db
        .query('chatroom_messages')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .collect();
    });
    const regularMessage = messagesInRegularTable.find((m) => m.content === 'second message');
    expect(regularMessage).toBeUndefined();

    // Verify task was created with queuedMessageId
    const task = await t.run(async (ctx) => {
      const tasks = await ctx.db
        .query('chatroom_tasks')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .collect();
      // Return the task that is not the seeded one (should be queued)
      return tasks.find((t) => t.status === 'queued');
    });
    expect(task).toBeDefined();
    expect(task?.status).toBe('queued');
    expect(task?.queuedMessageId).toBe(returnedId);
    expect(task?.sourceMessageId).toBeUndefined();
  });

  test('second user message → chatroom_messages does NOT contain the queued message', async () => {
    const { sessionId } = await createTestSession('msg-route-3');
    const chatroomId = await createChatroom(sessionId);

    // Seed an active task
    await seedActiveTask(chatroomId);

    // Send second user message
    await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      senderRole: 'user',
      content: 'queued message',
      type: 'message',
    });

    // Verify chatroom_messages only contains the initial task message (if any)
    // and NOT the queued message
    const messagesInRegularTable = await t.run(async (ctx) => {
      return await ctx.db
        .query('chatroom_messages')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .collect();
    });

    // Should not contain our queued message
    const queuedMessageInRegular = messagesInRegularTable.find(
      (m) => m.content === 'queued message'
    );
    expect(queuedMessageInRegular).toBeUndefined();
  });

  test('handoff message → always stored in chatroom_messages regardless of active tasks', async () => {
    const { sessionId } = await createTestSession('msg-route-4');
    const chatroomId = await createChatroom(sessionId);

    // Seed an active task
    await seedActiveTask(chatroomId);

    // Send handoff message (even with active task, should go to chatroom_messages)
    const messageId = await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      senderRole: 'builder',
      targetRole: 'reviewer',
      content: 'handoff message',
      type: 'handoff',
    });

    // Verify message is in chatroom_messages
    const message = await t.run(async (ctx) => {
      return await ctx.db.get('chatroom_messages', messageId as Id<'chatroom_messages'>);
    });
    expect(message).toBeDefined();
    expect(message?.content).toBe('handoff message');

    // Verify it's NOT in the queue (check by querying the table)
    const queuedMessages = await t.run(async (ctx) => {
      return await ctx.db
        .query('chatroom_messageQueue')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .collect();
    });
    const foundInQueue = queuedMessages.find((m) => m.content === 'handoff message');
    expect(foundInQueue).toBeUndefined();
  });

  test('queued user message → task.sourceMessageId is undefined, task.queuedMessageId is set', async () => {
    const { sessionId } = await createTestSession('msg-route-5');
    const chatroomId = await createChatroom(sessionId);

    // Seed an active task
    await seedActiveTask(chatroomId);

    // Send queued user message
    const returnedId = await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      senderRole: 'user',
      content: 'queued message',
      type: 'message',
    });

    // Find the queued task
    const queuedTask = await t.run(async (ctx) => {
      const tasks = await ctx.db
        .query('chatroom_tasks')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .collect();
      return tasks.find((t) => t.status === 'queued');
    });

    expect(queuedTask).toBeDefined();
    expect(queuedTask?.sourceMessageId).toBeUndefined();
    expect(queuedTask?.queuedMessageId).toBe(returnedId);
  });
});
