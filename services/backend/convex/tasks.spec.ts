/**
 * Tests for task mutations — promoteSpecificTask
 * Updated to work with new architecture: no tasks at queue time,
 * promoteSpecificTask takes queuedMessageId.
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

/** Creates a queue record (no task — task is created at promotion time) */
async function createQueueRecord(
  chatroomId: Id<'chatroom_rooms'>,
  content: string = 'queued message'
): Promise<Id<'chatroom_messageQueue'>> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert('chatroom_messageQueue', {
      chatroomId,
      senderRole: 'user',
      targetRole: 'builder',
      content,
      type: 'message',
      queuePosition: 1,
    });
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('promoteSpecificTask', () => {
  test('promotes a queued message to pending task when no active tasks exist', async () => {
    const { sessionId } = await createTestSession('promote-specific-1');
    const chatroomId = await createChatroom(sessionId);

    const queuedMessageId = await createQueueRecord(chatroomId, 'test queued task');

    // Promote it
    const result = await t.mutation(api.tasks.promoteSpecificTask, {
      sessionId,
      queuedMessageId,
    });

    expect(result.promoted).toBe(true);
    expect(result.reason).toBe('success');

    // Verify queue record was deleted
    const queueRecord = await t.run(async (ctx) => ctx.db.get('chatroom_messageQueue', queuedMessageId));
    expect(queueRecord).toBeNull();

    // Verify message was promoted to chatroom_messages
    const promotedMessage = await t.run(async (ctx) => {
      return await ctx.db
        .query('chatroom_messages')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .first();
    });
    expect(promotedMessage).toBeDefined();
    expect(promotedMessage?.content).toBe('test queued task');

    // Verify a pending task was created
    const task = await t.run(async (ctx) => {
      return await ctx.db
        .query('chatroom_tasks')
        .withIndex('by_chatroom_status', (q) =>
          q.eq('chatroomId', chatroomId).eq('status', 'pending')
        )
        .first();
    });
    expect(task).toBeDefined();
    expect(task?.status).toBe('pending');
    expect(task?.content).toBe('test queued task');
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
        createdAt: now,
        updatedAt: now,
        queuePosition: 0,
      });
    });

    const queuedMessageId = await createQueueRecord(chatroomId, 'queued task');

    // Try to promote — should fail gracefully
    const result = await t.mutation(api.tasks.promoteSpecificTask, {
      sessionId,
      queuedMessageId,
    });

    expect(result.promoted).toBe(false);
    expect(result.reason).toBe('active_task_exists');

    // Verify queue record is still there
    const queueRecord = await t.run(async (ctx) => ctx.db.get('chatroom_messageQueue', queuedMessageId));
    expect(queueRecord).toBeDefined();
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
        createdAt: now,
        updatedAt: now,
        queuePosition: 0,
      });
    });

    const queuedMessageId = await createQueueRecord(chatroomId, 'queued task');

    // Try to promote — should fail gracefully
    const result = await t.mutation(api.tasks.promoteSpecificTask, {
      sessionId,
      queuedMessageId,
    });

    expect(result.promoted).toBe(false);
    expect(result.reason).toBe('active_task_exists');

    // Verify queue record still exists
    const queueRecord = await t.run(async (ctx) => ctx.db.get('chatroom_messageQueue', queuedMessageId));
    expect(queueRecord).toBeDefined();
  });

  test('throws QUEUED_MESSAGE_NOT_FOUND if queue record does not exist', async () => {
    const { sessionId } = await createTestSession('promote-specific-4');
    const chatroomId = await createChatroom(sessionId);

    // Create a queue record and immediately delete it to get a valid-format but nonexistent ID
    const deletedId = await t.run(async (ctx) => {
      const id = await ctx.db.insert('chatroom_messageQueue', {
        chatroomId,
        senderRole: 'user',
        targetRole: 'builder',
        content: 'temp',
        type: 'message',
        queuePosition: 0,
      });
      await ctx.db.delete('chatroom_messageQueue', id);
      return id;
    });

    await expect(
      t.mutation(api.tasks.promoteSpecificTask, {
        sessionId,
        queuedMessageId: deletedId,
      })
    ).rejects.toThrow(/QUEUED_MESSAGE_NOT_FOUND|not found/i);
  });

  test('creates task and message from queue record on success', async () => {
    const { sessionId } = await createTestSession('promote-specific-5');
    const chatroomId = await createChatroom(sessionId);

    const queuedMessageId = await createQueueRecord(chatroomId, 'test message content');

    // Verify only queue record exists, no tasks yet
    const tasksBefore = await t.run(async (ctx) =>
      ctx.db.query('chatroom_tasks').withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId)).collect()
    );
    expect(tasksBefore.length).toBe(0);

    // Promote
    await t.mutation(api.tasks.promoteSpecificTask, {
      sessionId,
      queuedMessageId,
    });

    // Verify task and message were created
    const tasksAfter = await t.run(async (ctx) =>
      ctx.db.query('chatroom_tasks').withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId)).collect()
    );
    expect(tasksAfter.length).toBe(1);
    expect(tasksAfter[0]?.status).toBe('pending');
    expect(tasksAfter[0]?.content).toBe('test message content');

    const messages = await t.run(async (ctx) =>
      ctx.db.query('chatroom_messages').withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId)).collect()
    );
    expect(messages.length).toBe(1);
    expect(messages[0]?.content).toBe('test message content');
  });
});
