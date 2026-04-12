/**
 * Cursor-based Message Query Integration Tests
 *
 * Tests getLatestMessages, getMessagesSince, and getOlderMessages queries
 * that power the cursor-based message loading pipeline.
 */

import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import { t } from '../../test.setup';
import { createTestSession, createPairTeamChatroom, joinParticipant } from '../helpers/integration';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Send N numbered messages to a chatroom via the sendMessage mutation.
 * Returns after all messages are sent.
 */
async function sendMessages(sessionId: string, chatroomId: any, count: number, role = 'builder') {
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

// ---------------------------------------------------------------------------
// getLatestMessages
// ---------------------------------------------------------------------------

describe('getLatestMessages', () => {
  test('returns correct number of messages in ascending order', async () => {
    const { sessionId } = await createTestSession('cursor-latest-1');
    const chatroomId = await createPairTeamChatroom(sessionId);
    await joinParticipant(sessionId, chatroomId, 'builder');
    await sendMessages(sessionId, chatroomId, 5);

    const result = await t.query(api.messages.getLatestMessages, {
      sessionId: sessionId as any,
      chatroomId,
      limit: 3,
    });

    expect(result.messages).toHaveLength(3);
    // Ascending order — first message should have the smallest _creationTime
    expect(result.messages[0]._creationTime).toBeLessThan(result.messages[2]._creationTime);
    // Content should be the last 3 messages (3, 4, 5)
    expect(result.messages[0].content).toBe('message-3');
    expect(result.messages[1].content).toBe('message-4');
    expect(result.messages[2].content).toBe('message-5');
  });

  test('hasMore is true when more messages exist', async () => {
    const { sessionId } = await createTestSession('cursor-latest-2');
    const chatroomId = await createPairTeamChatroom(sessionId);
    await joinParticipant(sessionId, chatroomId, 'builder');
    await sendMessages(sessionId, chatroomId, 5);

    const result = await t.query(api.messages.getLatestMessages, {
      sessionId: sessionId as any,
      chatroomId,
      limit: 3,
    });

    expect(result.hasMore).toBe(true);
  });

  test('hasMore is false when all messages fit within limit', async () => {
    const { sessionId } = await createTestSession('cursor-latest-3');
    const chatroomId = await createPairTeamChatroom(sessionId);
    await joinParticipant(sessionId, chatroomId, 'builder');
    await sendMessages(sessionId, chatroomId, 2);

    const result = await t.query(api.messages.getLatestMessages, {
      sessionId: sessionId as any,
      chatroomId,
      limit: 5,
    });

    expect(result.messages).toHaveLength(2);
    expect(result.hasMore).toBe(false);
  });

  test('cursor equals _creationTime of newest message', async () => {
    const { sessionId } = await createTestSession('cursor-latest-4');
    const chatroomId = await createPairTeamChatroom(sessionId);
    await joinParticipant(sessionId, chatroomId, 'builder');
    await sendMessages(sessionId, chatroomId, 3);

    const result = await t.query(api.messages.getLatestMessages, {
      sessionId: sessionId as any,
      chatroomId,
      limit: 10,
    });

    const newestMessage = result.messages[result.messages.length - 1];
    expect(result.cursor).toBe(newestMessage._creationTime);
  });

  test('cursor is null when no messages exist', async () => {
    const { sessionId } = await createTestSession('cursor-latest-5');
    const chatroomId = await createPairTeamChatroom(sessionId);

    const result = await t.query(api.messages.getLatestMessages, {
      sessionId: sessionId as any,
      chatroomId,
      limit: 5,
    });

    expect(result.messages).toHaveLength(0);
    expect(result.cursor).toBeNull();
    expect(result.hasMore).toBe(false);
  });

  test('filters out join and progress type messages', async () => {
    const { sessionId } = await createTestSession('cursor-latest-6');
    const chatroomId = await createPairTeamChatroom(sessionId);

    // Insert join and progress messages directly via t.run
    await t.run(async (ctx) => {
      await ctx.db.insert('chatroom_messages', {
        chatroomId,
        senderRole: 'system',
        content: 'user joined',
        type: 'join',
      });
      await ctx.db.insert('chatroom_messages', {
        chatroomId,
        senderRole: 'builder',
        content: 'working on it...',
        type: 'progress',
      });
    });

    // Also send a regular message
    await joinParticipant(sessionId, chatroomId, 'builder');
    await t.mutation(api.messages.sendMessage, {
      sessionId: sessionId as any,
      chatroomId,
      senderRole: 'builder',
      content: 'real message',
      type: 'message',
    });

    const result = await t.query(api.messages.getLatestMessages, {
      sessionId: sessionId as any,
      chatroomId,
      limit: 10,
    });

    // Only the real message should be returned
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].content).toBe('real message');
  });
});

// ---------------------------------------------------------------------------
// getMessagesSince
// ---------------------------------------------------------------------------

describe('getMessagesSince', () => {
  test('returns only messages after the cursor', async () => {
    const { sessionId } = await createTestSession('cursor-since-1');
    const chatroomId = await createPairTeamChatroom(sessionId);
    await joinParticipant(sessionId, chatroomId, 'builder');
    await sendMessages(sessionId, chatroomId, 3);

    // Get initial load to get cursor
    const initial = await t.query(api.messages.getLatestMessages, {
      sessionId: sessionId as any,
      chatroomId,
      limit: 10,
    });

    const cursor = initial.cursor!;

    // Send more messages after the cursor
    await sendMessages(sessionId, chatroomId, 2, 'builder');

    const result = await t.query(api.messages.getMessagesSince, {
      sessionId: sessionId as any,
      chatroomId,
      sinceCursor: cursor,
    });

    // Should only get the 2 new messages
    expect(result.messages).toHaveLength(2);
    // In ascending order
    expect(result.messages[0]._creationTime).toBeLessThanOrEqual(result.messages[1]._creationTime);
  });

  test('returns empty when no new messages exist', async () => {
    const { sessionId } = await createTestSession('cursor-since-2');
    const chatroomId = await createPairTeamChatroom(sessionId);
    await joinParticipant(sessionId, chatroomId, 'builder');
    await sendMessages(sessionId, chatroomId, 2);

    const initial = await t.query(api.messages.getLatestMessages, {
      sessionId: sessionId as any,
      chatroomId,
      limit: 10,
    });

    const cursor = initial.cursor!;

    // Query since without sending new messages
    const result = await t.query(api.messages.getMessagesSince, {
      sessionId: sessionId as any,
      chatroomId,
      sinceCursor: cursor,
    });

    expect(result.messages).toHaveLength(0);
  });

  test('filters out join and progress type messages', async () => {
    const { sessionId } = await createTestSession('cursor-since-3');
    const chatroomId = await createPairTeamChatroom(sessionId);
    await joinParticipant(sessionId, chatroomId, 'builder');
    await sendMessages(sessionId, chatroomId, 1);

    const initial = await t.query(api.messages.getLatestMessages, {
      sessionId: sessionId as any,
      chatroomId,
      limit: 10,
    });

    const cursor = initial.cursor!;

    // Insert join/progress messages directly
    await t.run(async (ctx) => {
      await ctx.db.insert('chatroom_messages', {
        chatroomId,
        senderRole: 'system',
        content: 'user joined again',
        type: 'join',
      });
      await ctx.db.insert('chatroom_messages', {
        chatroomId,
        senderRole: 'builder',
        content: 'still working...',
        type: 'progress',
      });
    });

    // Also send a regular message
    await t.mutation(api.messages.sendMessage, {
      sessionId: sessionId as any,
      chatroomId,
      senderRole: 'builder',
      content: 'new real message',
      type: 'message',
    });

    const result = await t.query(api.messages.getMessagesSince, {
      sessionId: sessionId as any,
      chatroomId,
      sinceCursor: cursor,
    });

    // Only the real message should appear
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].content).toBe('new real message');
  });
});

// ---------------------------------------------------------------------------
// getOlderMessages
// ---------------------------------------------------------------------------

describe('getOlderMessages', () => {
  test('returns only messages before the cursor in ascending order', async () => {
    const { sessionId } = await createTestSession('cursor-older-1');
    const chatroomId = await createPairTeamChatroom(sessionId);
    await joinParticipant(sessionId, chatroomId, 'builder');
    await sendMessages(sessionId, chatroomId, 5);

    // Get the latest 2 messages to establish the cursor
    const latest = await t.query(api.messages.getLatestMessages, {
      sessionId: sessionId as any,
      chatroomId,
      limit: 2,
    });

    // Use the oldest message's _creationTime as the beforeCursor
    const beforeCursor = latest.messages[0]._creationTime;

    const result = await t.query(api.messages.getOlderMessages, {
      sessionId: sessionId as any,
      chatroomId,
      beforeCursor,
      limit: 10,
    });

    // Should return messages 1, 2, 3 (before message-4)
    expect(result.messages).toHaveLength(3);
    // Ascending order
    expect(result.messages[0]._creationTime).toBeLessThan(result.messages[2]._creationTime);
    expect(result.messages[0].content).toBe('message-1');
    expect(result.messages[1].content).toBe('message-2');
    expect(result.messages[2].content).toBe('message-3');
  });

  test('hasMore is true when more older messages exist', async () => {
    const { sessionId } = await createTestSession('cursor-older-2');
    const chatroomId = await createPairTeamChatroom(sessionId);
    await joinParticipant(sessionId, chatroomId, 'builder');
    await sendMessages(sessionId, chatroomId, 5);

    const latest = await t.query(api.messages.getLatestMessages, {
      sessionId: sessionId as any,
      chatroomId,
      limit: 1,
    });

    // Cursor at message-5, ask for 2 older messages
    const beforeCursor = latest.messages[0]._creationTime;

    const result = await t.query(api.messages.getOlderMessages, {
      sessionId: sessionId as any,
      chatroomId,
      beforeCursor,
      limit: 2,
    });

    expect(result.messages).toHaveLength(2);
    expect(result.hasMore).toBe(true);
  });

  test('hasMore is false when no more older messages exist', async () => {
    const { sessionId } = await createTestSession('cursor-older-3');
    const chatroomId = await createPairTeamChatroom(sessionId);
    await joinParticipant(sessionId, chatroomId, 'builder');
    await sendMessages(sessionId, chatroomId, 3);

    const latest = await t.query(api.messages.getLatestMessages, {
      sessionId: sessionId as any,
      chatroomId,
      limit: 1,
    });

    // Cursor at message-3, get all older messages (only 2 exist before it)
    const beforeCursor = latest.messages[0]._creationTime;

    const result = await t.query(api.messages.getOlderMessages, {
      sessionId: sessionId as any,
      chatroomId,
      beforeCursor,
      limit: 10,
    });

    expect(result.messages).toHaveLength(2);
    expect(result.hasMore).toBe(false);
  });

  test('filters out join and progress type messages', async () => {
    const { sessionId } = await createTestSession('cursor-older-4');
    const chatroomId = await createPairTeamChatroom(sessionId);
    await joinParticipant(sessionId, chatroomId, 'builder');

    // Send first message
    await t.mutation(api.messages.sendMessage, {
      sessionId: sessionId as any,
      chatroomId,
      senderRole: 'builder',
      content: 'real-old-message',
      type: 'message',
    });

    // Insert join/progress messages directly
    await t.run(async (ctx) => {
      await ctx.db.insert('chatroom_messages', {
        chatroomId,
        senderRole: 'system',
        content: 'joined',
        type: 'join',
      });
      await ctx.db.insert('chatroom_messages', {
        chatroomId,
        senderRole: 'builder',
        content: 'progress update',
        type: 'progress',
      });
    });

    // Send a newer message to use as cursor
    await t.mutation(api.messages.sendMessage, {
      sessionId: sessionId as any,
      chatroomId,
      senderRole: 'builder',
      content: 'newest-message',
      type: 'message',
    });

    const latest = await t.query(api.messages.getLatestMessages, {
      sessionId: sessionId as any,
      chatroomId,
      limit: 1,
    });

    const beforeCursor = latest.messages[0]._creationTime;

    const result = await t.query(api.messages.getOlderMessages, {
      sessionId: sessionId as any,
      chatroomId,
      beforeCursor,
      limit: 10,
    });

    // Only real-old-message should appear (join/progress filtered)
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].content).toBe('real-old-message');
  });
});
