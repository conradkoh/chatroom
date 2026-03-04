/**
 * Tests for task mutations — promoteSpecificTask
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

async function createQueuedTask(
  chatroomId: Id<'chatroom_rooms'>,
  content: string = 'queued task'
): Promise<Id<'chatroom_tasks'>> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    
    // Create task first (without queuedMessageId initially)
    const taskId = await ctx.db.insert('chatroom_tasks', {
      chatroomId,
      createdBy: 'user',
      content,
      status: 'queued',
      origin: 'chat',
      createdAt: now,
      updatedAt: now,
      queuePosition: 0,
    });
    
    // Create queued message with taskId
    const queuedMessageId = await ctx.db.insert('chatroom_messageQueue', {
      chatroomId,
      taskId,
      senderRole: 'user',
      targetRole: 'builder',
      content,
      type: 'message',
    });

    // Update task with queuedMessageId reference
    await ctx.db.patch(taskId, { queuedMessageId });

    return taskId;
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('promoteSpecificTask', () => {
  test('promotes a queued task to pending when no active tasks exist', async () => {
    const { sessionId } = await createTestSession('promote-specific-1');
    const chatroomId = await createChatroom(sessionId);

    // Create a queued task
    const taskId = await createQueuedTask(chatroomId, 'test queued task');

    // Verify it's queued
    const taskBefore = await t.run(async (ctx) => ctx.db.get(taskId));
    expect(taskBefore?.status).toBe('queued');

    // Promote it
    const result = await t.mutation(api.tasks.promoteSpecificTask, {
      sessionId,
      taskId,
    });

    // Verify promotion succeeded
    expect(result.promoted).toBe(true);
    expect(result.reason).toBe('success');

    // Verify task status changed
    const taskAfter = await t.run(async (ctx) => ctx.db.get(taskId));
    expect(taskAfter?.status).toBe('pending');

    // Verify message was promoted to chatroom_messages
    const queuedMessage = await t.run(async (ctx) => {
      return await ctx.db
        .query('chatroom_messageQueue')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .filter((q) => q.eq(q.field('taskId'), taskId))
        .first();
    });
    expect(queuedMessage).toBeNull();

    const promotedMessage = await t.run(async (ctx) => {
      return await ctx.db
        .query('chatroom_messages')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .filter((q) => q.eq(q.field('taskId'), taskId))
        .first();
    });
    expect(promotedMessage).toBeDefined();
  });

  test('returns active_task_exists when a pending task already exists', async () => {
    const { sessionId } = await createTestSession('promote-specific-2');
    const chatroomId = await createChatroom(sessionId);

    // Create a pending task
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert('chatroom_tasks', {
        chatroomId,
        createdBy: 'user',
        content: 'pending task',
        status: 'pending',
        origin: 'chat',
        createdAt: now,
        updatedAt: now,
        queuePosition: 0,
      });
    });

    // Create a queued task
    const taskId = await createQueuedTask(chatroomId, 'queued task');

    // Try to promote — should fail
    const result = await t.mutation(api.tasks.promoteSpecificTask, {
      sessionId,
      taskId,
    });

    expect(result.promoted).toBe(false);
    expect(result.reason).toBe('active_task_exists');

    // Verify task is still queued
    const task = await t.run(async (ctx) => ctx.db.get(taskId));
    expect(task?.status).toBe('queued');
  });

  test('returns active_task_exists when an in_progress task exists', async () => {
    const { sessionId } = await createTestSession('promote-specific-3');
    const chatroomId = await createChatroom(sessionId);

    // Create an in_progress task
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert('chatroom_tasks', {
        chatroomId,
        createdBy: 'user',
        content: 'in progress task',
        status: 'in_progress',
        origin: 'chat',
        createdAt: now,
        updatedAt: now,
        queuePosition: 0,
      });
    });

    // Create a queued task
    const taskId = await createQueuedTask(chatroomId, 'queued task');

    // Try to promote — should fail
    const result = await t.mutation(api.tasks.promoteSpecificTask, {
      sessionId,
      taskId,
    });

    expect(result.promoted).toBe(false);
    expect(result.reason).toBe('active_task_exists');

    // Verify task is still queued
    const task = await t.run(async (ctx) => ctx.db.get(taskId));
    expect(task?.status).toBe('queued');
  });

  test('throws INVALID_TASK_STATUS if task is not queued', async () => {
    const { sessionId } = await createTestSession('promote-specific-4');
    const chatroomId = await createChatroom(sessionId);

    // Create a pending task (not queued)
    const taskId = await t.run(async (ctx) => {
      const now = Date.now();
      return await ctx.db.insert('chatroom_tasks', {
        chatroomId,
        createdBy: 'user',
        content: 'pending task',
        status: 'pending',
        origin: 'chat',
        createdAt: now,
        updatedAt: now,
        queuePosition: 0,
      });
    });

    // Try to promote — should throw
    await expect(
      t.mutation(api.tasks.promoteSpecificTask, {
        sessionId,
        taskId,
      })
    ).rejects.toThrow(/must be in queued status/i);
  });

  test('calls promoteQueuedMessage to move message from queue to messages', async () => {
    const { sessionId } = await createTestSession('promote-specific-5');
    const chatroomId = await createChatroom(sessionId);

    // Create a queued task with a queued message
    const taskId = await createQueuedTask(chatroomId, 'test message content');

    // Verify queued message exists
    const queuedBefore = await t.run(async (ctx) => {
      return await ctx.db
        .query('chatroom_messageQueue')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .filter((q) => q.eq(q.field('taskId'), taskId))
        .first();
    });
    expect(queuedBefore).toBeDefined();
    expect(queuedBefore?.content).toBe('test message content');

    // Promote the task
    await t.mutation(api.tasks.promoteSpecificTask, {
      sessionId,
      taskId,
    });

    // Verify queued message was moved to chatroom_messages
    const queuedAfter = await t.run(async (ctx) => {
      return await ctx.db
        .query('chatroom_messageQueue')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .filter((q) => q.eq(q.field('taskId'), taskId))
        .first();
    });
    expect(queuedAfter).toBeNull();

    const promoted = await t.run(async (ctx) => {
      return await ctx.db
        .query('chatroom_messages')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .filter((q) => q.eq(q.field('taskId'), taskId))
        .first();
    });
    expect(promoted).toBeDefined();
    expect(promoted?.content).toBe('test message content');
  });
});
