/**
 * Tests for _sendMessageHandler — verifies queued user message routing.
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { t } from '../test.setup';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';

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
  });

  test('second user message (active task exists) → stored in chatroom_messageQueue, no task created yet', async () => {
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

    // Verify NO task was created (tasks are created at promotion time now)
    const tasks = await t.run(async (ctx) => {
      return await ctx.db
        .query('chatroom_tasks')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .collect();
    });
    // Only the seeded in_progress task should exist — no new task (tasks created at promotion time)
    expect(tasks.length).toBe(1); // Just the seeded one
    expect(tasks[0]?.status).toBe('in_progress');
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

  test('queued user message → only queue record created, no task yet', async () => {
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

    // Verify queue record was created
    const queueRecord = await t.run(async (ctx) => {
      return await ctx.db.get('chatroom_messageQueue', returnedId as Id<'chatroom_messageQueue'>);
    });
    expect(queueRecord).toBeDefined();
    expect(queueRecord?.content).toBe('queued message');

    // Verify NO new task was created (only the seeded one should exist)
    const tasks = await t.run(async (ctx) => {
      return await ctx.db
        .query('chatroom_tasks')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .collect();
    });
    // Should only have the seeded in_progress task
    expect(tasks.length).toBe(1);
    expect(tasks[0]?.status).toBe('in_progress');
  });
});

describe('listQueued query', () => {
  test('returns queued messages for a chatroom in creation order', async () => {
    const { sessionId } = await createTestSession('list-queued-1');
    const chatroomId = await createChatroom(sessionId);

    // Seed an active task to trigger queuing behavior
    await seedActiveTask(chatroomId);

    // Send two queued messages
    await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      senderRole: 'user',
      content: 'first queued message',
      type: 'message',
    });

    await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      senderRole: 'user',
      content: 'second queued message',
      type: 'message',
    });

    // Fetch queued messages
    const queuedMessages = await t.query(api.messages.listQueued, {
      sessionId,
      chatroomId,
    });

    expect(queuedMessages.length).toBe(2);
    expect(queuedMessages[0].content).toBe('first queued message');
    expect(queuedMessages[1].content).toBe('second queued message');
    expect(queuedMessages[0].isQueued).toBe(true);
    expect(queuedMessages[1].isQueued).toBe(true);
  });

  test('returns empty array when no queued messages exist', async () => {
    const { sessionId } = await createTestSession('list-queued-2');
    const chatroomId = await createChatroom(sessionId);

    // No queued messages - chatroom is empty
    const queuedMessages = await t.query(api.messages.listQueued, {
      sessionId,
      chatroomId,
    });

    expect(queuedMessages).toEqual([]);
  });

  test('does not return messages from chatroom_messages table', async () => {
    const { sessionId } = await createTestSession('list-queued-3');
    const chatroomId = await createChatroom(sessionId);

    // Send a regular message (no active tasks, so it goes to chatroom_messages)
    await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      senderRole: 'user',
      content: 'regular message',
      type: 'message',
    });

    // Fetch queued messages (should be empty)
    const queuedMessages = await t.query(api.messages.listQueued, {
      sessionId,
      chatroomId,
    });

    expect(queuedMessages).toEqual([]);
  });
});

describe('_handoffHandler — queued task promotion on handoff-to-user', () => {
  test('when handing off to user and queued tasks exist, promotes first queued task to pending', async () => {
    const { sessionId } = await createTestSession('handoff-promote-1');
    const chatroomId = await createChatroom(sessionId);

    // Create an in_progress task for the builder (will be completed by handoff)
    const activeTaskId = await t.run(async (ctx) => {
      const now = Date.now();
      return await ctx.db.insert('chatroom_tasks', {
        chatroomId,
        createdBy: 'user',
        content: 'task in progress',
        status: 'in_progress',
        createdAt: now,
        updatedAt: now,
        queuePosition: 0,
        assignedTo: 'builder',
      });
    });

    // Send a user message while the builder is working (should be queued)
    await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      senderRole: 'user',
      content: 'queued message',
      type: 'message',
    });

    // Verify the message was queued
    const queuedBefore = await t.query(api.messages.listQueued, {
      sessionId,
      chatroomId,
    });
    expect(queuedBefore.length).toBe(1);

    // Mark the active task as having a sourceMessageId (simulate task-started)
    await t.run(async (ctx) => {
      const msg = await ctx.db
        .query('chatroom_messages')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .filter((q) => q.eq(q.field('content'), 'task in progress'))
        .first();
      if (msg) {
        await ctx.db.patch(activeTaskId, { sourceMessageId: msg._id });
      }
    });

    // Builder hands off to user (should complete the task + promote queued task)
    const result = await t.mutation(api.messages.handoff, {
      sessionId,
      chatroomId,
      senderRole: 'builder',
      content: 'work complete',
      targetRole: 'user',
    });

    // Verify promotion happened
    expect(result.success).toBe(true);
    expect(result.promotedTaskId).toBeDefined();

    // Verify the queued message is now promoted to chatroom_messages
    const queuedAfter = await t.query(api.messages.listQueued, {
      sessionId,
      chatroomId,
    });
    expect(queuedAfter.length).toBe(0);

    // Verify the task status is now pending
    const promotedTask = await t.run(async (ctx) => {
      return await ctx.db.get(result.promotedTaskId!);
    });
    expect(promotedTask?.status).toBe('pending');
  });

  test('when handing off to user and no queued tasks, no promotion happens', async () => {
    const { sessionId } = await createTestSession('handoff-promote-2');
    const chatroomId = await createChatroom(sessionId);

    // Create an in_progress task for the builder (will be completed by handoff)
    const activeTaskId = await t.run(async (ctx) => {
      const now = Date.now();
      return await ctx.db.insert('chatroom_tasks', {
        chatroomId,
        createdBy: 'user',
        content: 'task in progress',
        status: 'in_progress',
        createdAt: now,
        updatedAt: now,
        queuePosition: 0,
        assignedTo: 'builder',
      });
    });

    // Mark the active task as having a sourceMessageId (simulate task-started)
    await t.run(async (ctx) => {
      const msg = await ctx.db
        .query('chatroom_messages')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .filter((q) => q.eq(q.field('content'), 'task in progress'))
        .first();
      if (msg) {
        await ctx.db.patch(activeTaskId, { sourceMessageId: msg._id });
      }
    });

    // Builder hands off to user (no queued tasks to promote)
    const result = await t.mutation(api.messages.handoff, {
      sessionId,
      chatroomId,
      senderRole: 'builder',
      content: 'work complete',
      targetRole: 'user',
    });

    // Verify no promotion happened
    expect(result.success).toBe(true);
    expect(result.promotedTaskId).toBeNull();
  });

  test('when handing off to agent (not user), queued tasks are NOT promoted', async () => {
    const { sessionId } = await createTestSession('handoff-promote-3');
    const chatroomId = await createChatroom(sessionId);

    // Create an in_progress task for the builder (will be completed by handoff)
    const activeTaskId = await t.run(async (ctx) => {
      const now = Date.now();
      return await ctx.db.insert('chatroom_tasks', {
        chatroomId,
        createdBy: 'user',
        content: 'task in progress',
        status: 'in_progress',
        createdAt: now,
        updatedAt: now,
        queuePosition: 0,
        assignedTo: 'builder',
      });
    });

    // Send a user message while the builder is working (should be queued)
    await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      senderRole: 'user',
      content: 'queued message',
      type: 'message',
    });

    // Verify the message was queued
    const queuedBefore = await t.query(api.messages.listQueued, {
      sessionId,
      chatroomId,
    });
    expect(queuedBefore.length).toBe(1);

    // Mark the active task as having a sourceMessageId (simulate task-started)
    await t.run(async (ctx) => {
      const msg = await ctx.db
        .query('chatroom_messages')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .filter((q) => q.eq(q.field('content'), 'task in progress'))
        .first();
      if (msg) {
        await ctx.db.patch(activeTaskId, { sourceMessageId: msg._id });
      }
    });

    // Builder hands off to reviewer (agent-to-agent handoff)
    const result = await t.mutation(api.messages.handoff, {
      sessionId,
      chatroomId,
      senderRole: 'builder',
      content: 'ready for review',
      targetRole: 'reviewer',
    });

    // Verify NO explicit promotion (queued task stays queued)
    expect(result.success).toBe(true);
    expect(result.promotedTaskId).toBeNull();

    // Queued message still in queue
    const queuedAfter = await t.query(api.messages.listQueued, {
      sessionId,
      chatroomId,
    });
    expect(queuedAfter.length).toBe(1);
  });
});
