/**
 * Integration tests for the new cursor-paginated message list API.
 *
 * Tests listMessages (paginated) and subscribeNewMessages (reactive tail)
 * from convex/messageList.ts.
 */

import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import { t } from '../../test.setup';
import { createTestSession, createDuoTeamChatroom, joinParticipant } from '../helpers/integration';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function sendMessages(
  sessionId: string,
  chatroomId: any,
  count: number,
  role = 'builder'
): Promise<void> {
  for (let i = 1; i <= count; i++) {
    await t.mutation(api.messages.sendMessage, {
      sessionId: sessionId as any,
      chatroomId,
      senderRole: role,
      content: `message-${i}`,
      type: 'message',
    });
  }
}

async function sendMessageOfType(
  sessionId: string,
  chatroomId: any,
  type: string,
  role = 'builder'
): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert('chatroom_messages', {
      chatroomId,
      senderRole: role,
      content: `${type} message`,
      type: type as any,
    });
  });
}

// ---------------------------------------------------------------------------
// listMessages
// ---------------------------------------------------------------------------

describe('listMessages', () => {
  test('empty chatroom → empty page, isDone=true', async () => {
    const { sessionId } = await createTestSession('ml-empty-1');
    const chatroomId = await createDuoTeamChatroom(sessionId);

    const result = await t.query(api.messageList.listMessages, {
      sessionId: sessionId as any,
      chatroomId,
      paginationOpts: { numItems: 20, cursor: null },
    });

    expect(result.page).toHaveLength(0);
    expect(result.isDone).toBe(true);
  });

  test('returns up to numItems messages, newest-first, isDone=false when more exist', async () => {
    const { sessionId } = await createTestSession('ml-paginated-1');
    const chatroomId = await createDuoTeamChatroom(sessionId);
    await joinParticipant(sessionId, chatroomId, 'builder');
    await sendMessages(sessionId, chatroomId, 25);

    const firstPage = await t.query(api.messageList.listMessages, {
      sessionId: sessionId as any,
      chatroomId,
      paginationOpts: { numItems: 20, cursor: null },
    });

    // First page: 20 newest messages in DESC order
    expect(firstPage.page).toHaveLength(20);
    expect(firstPage.isDone).toBe(false);
    // Descending order: first item is the newest
    expect(firstPage.page[0]!.content).toBe('message-25');
    expect(firstPage.page[19]!.content).toBe('message-6');
  });

  test('second page with continueCursor returns remaining messages, isDone=true', async () => {
    const { sessionId } = await createTestSession('ml-paginated-2');
    const chatroomId = await createDuoTeamChatroom(sessionId);
    await joinParticipant(sessionId, chatroomId, 'builder');
    await sendMessages(sessionId, chatroomId, 25);

    const firstPage = await t.query(api.messageList.listMessages, {
      sessionId: sessionId as any,
      chatroomId,
      paginationOpts: { numItems: 20, cursor: null },
    });
    expect(firstPage.isDone).toBe(false);

    const secondPage = await t.query(api.messageList.listMessages, {
      sessionId: sessionId as any,
      chatroomId,
      paginationOpts: { numItems: 20, cursor: firstPage.continueCursor },
    });

    // Remaining 5 messages
    expect(secondPage.page).toHaveLength(5);
    expect(secondPage.isDone).toBe(true);
    // Continuing descent: messages 5 down to 1
    expect(secondPage.page[0]!.content).toBe('message-5');
    expect(secondPage.page[4]!.content).toBe('message-1');
  });

  test('filters out join and progress message types', async () => {
    const { sessionId } = await createTestSession('ml-filter-1');
    const chatroomId = await createDuoTeamChatroom(sessionId);
    await joinParticipant(sessionId, chatroomId, 'builder');

    await sendMessages(sessionId, chatroomId, 3); // 3 normal messages
    await sendMessageOfType(sessionId, chatroomId, 'join'); // filtered out
    await sendMessageOfType(sessionId, chatroomId, 'progress'); // filtered out

    const result = await t.query(api.messageList.listMessages, {
      sessionId: sessionId as any,
      chatroomId,
      paginationOpts: { numItems: 20, cursor: null },
    });

    expect(result.page).toHaveLength(3);
    for (const msg of result.page) {
      expect(msg.type).not.toBe('join');
      expect(msg.type).not.toBe('progress');
    }
  });

  test('rejects access from unauthenticated session', async () => {
    const { sessionId } = await createTestSession('ml-auth-1');
    const chatroomId = await createDuoTeamChatroom(sessionId);

    await expect(
      t.query(api.messageList.listMessages, {
        sessionId: 'invalid-session' as any,
        chatroomId,
        paginationOpts: { numItems: 20, cursor: null },
      })
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// subscribeNewMessages
// ---------------------------------------------------------------------------

describe('subscribeNewMessages', () => {
  test('sinceCreationTime=0 returns all filtered messages in ascending order', async () => {
    const { sessionId } = await createTestSession('ml-sub-1');
    const chatroomId = await createDuoTeamChatroom(sessionId);
    await joinParticipant(sessionId, chatroomId, 'builder');
    await sendMessages(sessionId, chatroomId, 5);

    const result = await t.query(api.messageList.subscribeNewMessages, {
      sessionId: sessionId as any,
      chatroomId,
      sinceCreationTime: 0,
    });

    expect(result).toHaveLength(5);
    // Ascending order: first is oldest
    expect(result[0]!.content).toBe('message-1');
    expect(result[4]!.content).toBe('message-5');
  });

  test('returns only messages newer than sinceCreationTime', async () => {
    const { sessionId } = await createTestSession('ml-sub-2');
    const chatroomId = await createDuoTeamChatroom(sessionId);
    await joinParticipant(sessionId, chatroomId, 'builder');
    await sendMessages(sessionId, chatroomId, 5);

    // Get all messages first to find the midpoint cursor
    const allMessages = await t.query(api.messageList.subscribeNewMessages, {
      sessionId: sessionId as any,
      chatroomId,
      sinceCreationTime: 0,
    });
    expect(allMessages).toHaveLength(5);

    // Use the 3rd message's _creationTime as boundary
    const midpointCursor = allMessages[2]!._creationTime;

    const result = await t.query(api.messageList.subscribeNewMessages, {
      sessionId: sessionId as any,
      chatroomId,
      sinceCreationTime: midpointCursor,
    });

    // Should return messages 4 and 5 only (strictly after the cursor)
    expect(result).toHaveLength(2);
    expect(result[0]!.content).toBe('message-4');
    expect(result[1]!.content).toBe('message-5');
  });

  test('filters out join and progress types', async () => {
    const { sessionId } = await createTestSession('ml-sub-filter-1');
    const chatroomId = await createDuoTeamChatroom(sessionId);
    await joinParticipant(sessionId, chatroomId, 'builder');

    await sendMessages(sessionId, chatroomId, 3);
    await sendMessageOfType(sessionId, chatroomId, 'join');
    await sendMessageOfType(sessionId, chatroomId, 'progress');

    const result = await t.query(api.messageList.subscribeNewMessages, {
      sessionId: sessionId as any,
      chatroomId,
      sinceCreationTime: 0,
    });

    expect(result).toHaveLength(3);
    for (const msg of result) {
      expect(msg.type).not.toBe('join');
      expect(msg.type).not.toBe('progress');
    }
  });

  test('200-cap respected when chatroom has many messages', async () => {
    const { sessionId } = await createTestSession('ml-sub-cap-1');
    const chatroomId = await createDuoTeamChatroom(sessionId);
    await joinParticipant(sessionId, chatroomId, 'builder');
    await sendMessages(sessionId, chatroomId, 205);

    const result = await t.query(api.messageList.subscribeNewMessages, {
      sessionId: sessionId as any,
      chatroomId,
      sinceCreationTime: 0,
    });

    expect(result.length).toBeLessThanOrEqual(200);
  });

  test('rejects access from unauthenticated session', async () => {
    const { sessionId } = await createTestSession('ml-sub-auth-1');
    const chatroomId = await createDuoTeamChatroom(sessionId);

    await expect(
      t.query(api.messageList.subscribeNewMessages, {
        sessionId: 'invalid-session' as any,
        chatroomId,
        sinceCreationTime: 0,
      })
    ).rejects.toThrow();
  });
});
