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

describe('subscribeMessagesSince — bounded fetch', () => {
  test('fetches at most MAX_MESSAGES_SINCE_LIMIT rows (500)', async () => {
    const { sessionId } = await createTestSession('bounded-list-1');
    const chatroomId = await createChatroom(sessionId);

    // Seed 600 messages — more than the 500 limit
    await seedMessages(chatroomId, 600);

    const result = await t.query(api.messageList.subscribeMessagesSince, {
      sessionId,
      chatroomId,
      afterCreationTime: 0,
    });

    // Should be capped at 500
    expect(result.length).toBeLessThanOrEqual(500);
  });

  test('returns all messages when count is below limit', async () => {
    const { sessionId } = await createTestSession('bounded-list-2');
    const chatroomId = await createChatroom(sessionId);

    // Seed 100 messages — well below the 500 limit
    const messageIds = await seedMessages(chatroomId, 100);

    const result = await t.query(api.messageList.subscribeMessagesSince, {
      sessionId,
      chatroomId,
      afterCreationTime: 0,
    });

    // Should return all 100 messages
    expect(result.length).toBe(100);
    expect(result.map((m) => m._id)).toEqual(messageIds);
  });
});

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
