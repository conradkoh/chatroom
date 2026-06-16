/**
 * Tests for messageList — bounded fetch queries.
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
    teamId: 'duo',
    teamName: 'Pair Team',
    teamRoles: ['builder', 'reviewer'],
    teamEntryPoint: 'builder',
  });
}

async function seedMessages(
  chatroomId: Id<'chatroom_rooms'>,
  count: number
): Promise<Id<'chatroom_messages'>[]> {
  return await t.run(async (ctx) => {
    const ids: Id<'chatroom_messages'>[] = [];
    for (let i = 0; i < count; i++) {
      const id = await ctx.db.insert('chatroom_messages', {
        chatroomId,
        senderRole: 'user',
        targetRole: 'builder',
        content: `message ${i}`,
        type: 'message',
      });
      ids.push(id as Id<'chatroom_messages'>);
    }
    return ids;
  });
}

async function seedQueuedMessages(
  chatroomId: Id<'chatroom_rooms'>,
  count: number
): Promise<Id<'chatroom_messageQueue'>[]> {
  return await t.run(async (ctx) => {
    const ids: Id<'chatroom_messageQueue'>[] = [];
    for (let i = 0; i < count; i++) {
      const id = await ctx.db.insert('chatroom_messageQueue', {
        chatroomId,
        senderRole: 'user',
        targetRole: 'builder',
        content: `queued ${i}`,
        type: 'message',
        queuePosition: i,
      });
      ids.push(id as Id<'chatroom_messageQueue'>);
    }
    return ids;
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('listQueued — bounded fetch', () => {
  test('respects limit cap when using .take()', async () => {
    const { sessionId } = await createTestSession('bounded-queued-1');
    const chatroomId = await createChatroom(sessionId);

    // Seed 1500 queued messages — more than the 1000 limit
    await seedQueuedMessages(chatroomId, 1500);

    const result = await t.query(api.messages.listQueued, {
      sessionId,
      chatroomId,
    });

    // Should be capped at 1000
    expect(result.length).toBeLessThanOrEqual(1000);
  });

  test('respects custom limit when provided', async () => {
    const { sessionId } = await createTestSession('bounded-queued-2');
    const chatroomId = await createChatroom(sessionId);

    // Seed 50 queued messages
    await seedQueuedMessages(chatroomId, 50);

    const result = await t.query(api.messages.listQueued, {
      sessionId,
      chatroomId,
      limit: 20,
    });

    // Should respect the custom limit of 20
    expect(result.length).toBe(20);
  });

  test('returns all queued messages when count is below limit', async () => {
    const { sessionId } = await createTestSession('bounded-queued-3');
    const chatroomId = await createChatroom(sessionId);

    // Seed 50 queued messages — well below the 1000 limit
    await seedQueuedMessages(chatroomId, 50);

    const result = await t.query(api.messages.listQueued, {
      sessionId,
      chatroomId,
    });

    // Should return all 50 messages
    expect(result.length).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// subscribeNewMessages — strict-after cursor
// ---------------------------------------------------------------------------

describe('subscribeNewMessages — strict-after cursor', () => {
  test('returns only messages strictly after the cursor (excludes the cursor row)', async () => {
    const { sessionId } = await createTestSession('new-msgs-1');
    const chatroomId = await createChatroom(sessionId);

    const ids = await seedMessages(chatroomId, 5);

    // Get the _creationTime of the 3rd message (index 2) as cursor
    const cursor = await t.run(async (ctx) => {
      const msg = await ctx.db.get('chatroom_messages', ids[2]);
      if (!msg) throw new Error('seeded message not found');
      return msg._creationTime;
    });

    const result = await t.query(api.messageList.subscribeNewMessages, {
      sessionId,
      chatroomId,
      afterCreationTime: cursor,
    });

    // Should exclude the cursor row (index 2) and include only strictly after (indices 3, 4)
    expect(result.length).toBe(2);
    expect(result[0]._id).toBe(ids[3]);
    expect(result[1]._id).toBe(ids[4]);
  });

  test('returns empty when cursor is at/after the newest message', async () => {
    const { sessionId } = await createTestSession('new-msgs-2');
    const chatroomId = await createChatroom(sessionId);

    const ids = await seedMessages(chatroomId, 3);

    // Use _creationTime of the newest (last) message as cursor
    const cursor = await t.run(async (ctx) => {
      const msg = await ctx.db.get('chatroom_messages', ids[2]);
      if (!msg) throw new Error('seeded message not found');
      return msg._creationTime;
    });

    const result = await t.query(api.messageList.subscribeNewMessages, {
      sessionId,
      chatroomId,
      afterCreationTime: cursor,
    });

    expect(result.length).toBe(0);
  });

  test('caps at MAX_NEW_MESSAGES_LIMIT (500)', async () => {
    const { sessionId } = await createTestSession('new-msgs-3');
    const chatroomId = await createChatroom(sessionId);

    // Seed 600 messages — more than the 500 limit
    await seedMessages(chatroomId, 600);

    const result = await t.query(api.messageList.subscribeNewMessages, {
      sessionId,
      chatroomId,
      afterCreationTime: 0,
    });

    expect(result.length).toBeLessThanOrEqual(500);
  });
});

// ---------------------------------------------------------------------------
// subscribeVisibleMessageUpdates — lightweight delta
// ---------------------------------------------------------------------------

describe('subscribeVisibleMessageUpdates — lightweight delta', () => {
  test('returns taskStatus + latestProgress for requested ids only', async () => {
    const { sessionId } = await createTestSession('visible-updates-1');
    const chatroomId = await createChatroom(sessionId);

    const now = Date.now();

    // Insert a task
    const taskId = await t.run(async (ctx) => {
      return await ctx.db.insert('chatroom_tasks', {
        chatroomId,
        createdBy: 'user',
        content: 'test task',
        status: 'in_progress',
        createdAt: now,
        updatedAt: now,
        queuePosition: 0,
      });
    });

    // Insert a message linked to the task
    const messageId = await t.run(async (ctx) => {
      return await ctx.db.insert('chatroom_messages', {
        chatroomId,
        senderRole: 'user',
        targetRole: 'builder',
        content: 'message with task',
        type: 'message',
        taskId: taskId as Id<'chatroom_tasks'>,
      });
    });

    // Insert a progress message for the task
    await t.run(async (ctx) => {
      return await ctx.db.insert('chatroom_messages', {
        chatroomId,
        senderRole: 'builder',
        content: 'working on it',
        type: 'progress',
        taskId: taskId as Id<'chatroom_tasks'>,
      });
    });

    // Query visible message updates
    const result = await t.query(api.messageList.subscribeVisibleMessageUpdates, {
      sessionId,
      chatroomId,
      messageIds: [messageId as Id<'chatroom_messages'>],
    });

    expect(result.length).toBe(1);
    expect(result[0]._id).toBe(messageId);
    expect(result[0].taskStatus).toBe('in_progress');
    const progress = result[0].latestProgress;
    expect(progress).toBeDefined();
    expect(progress?.content).toBe('working on it');
    expect(progress?.senderRole).toBe('builder');
  });

  test('returns undefined fields for a message with no task', async () => {
    const { sessionId } = await createTestSession('visible-updates-2');
    const chatroomId = await createChatroom(sessionId);

    const ids = await seedMessages(chatroomId, 1);

    const result = await t.query(api.messageList.subscribeVisibleMessageUpdates, {
      sessionId,
      chatroomId,
      messageIds: [ids[0]],
    });

    expect(result.length).toBe(1);
    expect(result[0]._id).toBe(ids[0]);
    expect(result[0].taskStatus).toBeUndefined();
    expect(result[0].latestProgress).toBeUndefined();
  });

  test('ignores ids from a different chatroom', async () => {
    const { sessionId } = await createTestSession('visible-updates-3');
    const chatroomA = await createChatroom(sessionId);
    const chatroomB = await createChatroom(sessionId);

    const idsA = await seedMessages(chatroomA, 1);

    const result = await t.query(api.messageList.subscribeVisibleMessageUpdates, {
      sessionId,
      chatroomId: chatroomB,
      messageIds: [idsA[0]],
    });

    expect(result.length).toBe(0);
  });

  test('caps input at MAX_VISIBLE_UPDATE_IDS (100)', async () => {
    const { sessionId } = await createTestSession('visible-updates-4');
    const chatroomId = await createChatroom(sessionId);

    const ids = await seedMessages(chatroomId, 150);

    const result = await t.query(api.messageList.subscribeVisibleMessageUpdates, {
      sessionId,
      chatroomId,
      messageIds: ids,
    });

    // Should be capped at 100 (no throw, max 100 results)
    expect(result.length).toBeLessThanOrEqual(100);
  });
});
