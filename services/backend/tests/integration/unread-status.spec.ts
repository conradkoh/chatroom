/**
 * Unread Status Integration Tests
 *
 * Tests that message sends update chatroom_unreadStatus and
 * markAsRead clears it.
 */

import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import { t } from '../../test.setup';
import { createTestSession, createPairTeamChatroom, joinParticipant } from '../helpers/integration';

describe('Unread Status Tracking', () => {
  test('non-user message marks chatroom as unread', async () => {
    const { sessionId } = await createTestSession('test-unread-1');
    const chatroomId = await createPairTeamChatroom(sessionId);

    // Join as builder
    await joinParticipant(sessionId, chatroomId, 'builder');

    // Send message from builder (non-user) role
    await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      senderRole: 'builder',
      content: 'hello from builder',
      type: 'message',
    });

    // Check unread status
    const status = await t.run(async (ctx) => {
      const userId = (await ctx.db.query('users').first())!._id;
      return await ctx.db
        .query('chatroom_unreadStatus')
        .withIndex('by_userId_chatroomId', (q: any) =>
          q.eq('userId', userId).eq('chatroomId', chatroomId)
        )
        .first();
    });

    expect(status).not.toBeNull();
    expect(status!.hasUnread).toBe(true);
  });

  test('markAsRead clears unread status', async () => {
    const { sessionId } = await createTestSession('test-unread-2');
    const chatroomId = await createPairTeamChatroom(sessionId);

    // Join as builder and send message
    await joinParticipant(sessionId, chatroomId, 'builder');
    await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      senderRole: 'builder',
      content: 'hello',
      type: 'message',
    });

    // Mark as read
    await t.mutation(api.chatrooms.markAsRead, {
      sessionId,
      chatroomId,
    });

    // Check unread is cleared
    const status = await t.run(async (ctx) => {
      const userId = (await ctx.db.query('users').first())!._id;
      return await ctx.db
        .query('chatroom_unreadStatus')
        .withIndex('by_userId_chatroomId', (q: any) =>
          q.eq('userId', userId).eq('chatroomId', chatroomId)
        )
        .first();
    });

    if (status) {
      expect(status.hasUnread).toBe(false);
      expect(status.hasUnreadHandoff).toBe(false);
    }
  });
});
