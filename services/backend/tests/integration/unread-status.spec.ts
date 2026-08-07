/**
 * Unread Status Integration Tests
 *
 * Tests that message sends update chatroom_unreadStatus and
 * markAsRead clears it.
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import { t } from '../../test.setup';
import {
  createTestSession,
  createBuilderEntryDuoChatroom,
  joinParticipant,
} from '../helpers/integration';

describe('Unread Status Tracking', () => {
  test('non-user message marks chatroom as unread', async () => {
    const { sessionId } = await createTestSession('test-unread-1');
    const chatroomId = await createBuilderEntryDuoChatroom(sessionId);

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
    const chatroomId = await createBuilderEntryDuoChatroom(sessionId);

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

  test('markAsRead skips redundant cursor patch within freshness window', async () => {
    const sessionKey = 'test-unread-3';
    const login = await t.mutation(api.auth.loginAnon, { sessionId: sessionKey as SessionId });
    const sessionId = sessionKey as SessionId;
    const chatroomId = await createBuilderEntryDuoChatroom(sessionId);
    await joinParticipant(sessionId, chatroomId, 'builder');

    await t.mutation(api.chatrooms.markAsRead, { sessionId, chatroomId });
    const afterFirst = await t.run(async (ctx) => {
      return await ctx.db
        .query('chatroom_read_cursors')
        .withIndex('by_userId_chatroomId', (q) =>
          q.eq('userId', login.userId!).eq('chatroomId', chatroomId)
        )
        .first();
    });
    expect(afterFirst).not.toBeNull();

    await t.mutation(api.chatrooms.markAsRead, { sessionId, chatroomId });

    const afterSecond = await t.run(async (ctx) => {
      return await ctx.db
        .query('chatroom_read_cursors')
        .withIndex('by_userId_chatroomId', (q) =>
          q.eq('userId', login.userId!).eq('chatroomId', chatroomId)
        )
        .first();
    });

    expect(afterSecond?.updatedAt).toBe(afterFirst?.updatedAt);
  });

  test('handoff-to-user with queued messages does not set hasUnreadHandoff', async () => {
    const { sessionId } = await createTestSession('test-unread-handoff-queue');
    const chatroomId = await createBuilderEntryDuoChatroom(sessionId);
    await joinParticipant(sessionId, chatroomId, 'builder');

    await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      senderRole: 'user',
      content: 'first message',
      type: 'message',
    });
    await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      senderRole: 'user',
      content: 'second message',
      type: 'message',
    });

    await t.mutation(api.tasks.claimTask, { sessionId, chatroomId, role: 'builder' });
    const acknowledgedTask = await t.run(async (ctx) => {
      return ctx.db
        .query('chatroom_tasks')
        .withIndex('by_chatroom_status', (q) =>
          q.eq('chatroomId', chatroomId).eq('status', 'acknowledged')
        )
        .first();
    });
    expect(acknowledgedTask).not.toBeNull();
    await t.mutation(api.tasks.readTask, {
      sessionId,
      chatroomId,
      role: 'builder',
      taskId: acknowledgedTask!._id,
    });

    await t.mutation(api.messages.handoff, {
      sessionId,
      chatroomId,
      senderRole: 'builder',
      targetRole: 'user',
      content: 'Done with first — more queued',
    });

    const status = await t.run(async (ctx) => {
      const chatroom = await ctx.db.get('chatroom_rooms', chatroomId);
      return await ctx.db
        .query('chatroom_unreadStatus')
        .withIndex('by_userId_chatroomId', (q: any) =>
          q.eq('userId', chatroom!.ownerId).eq('chatroomId', chatroomId)
        )
        .first();
    });

    expect(status).not.toBeNull();
    expect(status!.hasUnread).toBe(true);
    expect(status!.hasUnreadHandoff).toBe(false);
  });

  test('markAsUnread sets hasUnread without changing read cursor', async () => {
    const sessionKey = 'test-mark-unread';
    const login = await t.mutation(api.auth.loginAnon, { sessionId: sessionKey as SessionId });
    const sessionId = sessionKey as SessionId;
    const chatroomId = await createBuilderEntryDuoChatroom(sessionId);

    // Mark as read first (establishes cursor)
    await t.mutation(api.chatrooms.markAsRead, { sessionId, chatroomId });

    const cursorBefore = await t.run(async (ctx) => {
      return ctx.db
        .query('chatroom_read_cursors')
        .withIndex('by_userId_chatroomId', (q: any) =>
          q.eq('userId', login.userId!).eq('chatroomId', chatroomId)
        )
        .first();
    });
    expect(cursorBefore).not.toBeNull();

    // Mark as unread
    await t.mutation(api.chatrooms.markAsUnread, { sessionId, chatroomId });

    const status = await t.run(async (ctx) => {
      return ctx.db
        .query('chatroom_unreadStatus')
        .withIndex('by_userId_chatroomId', (q: any) =>
          q.eq('userId', login.userId!).eq('chatroomId', chatroomId)
        )
        .first();
    });
    expect(status?.hasUnread).toBe(true);

    const cursorAfter = await t.run(async (ctx) => {
      return ctx.db
        .query('chatroom_read_cursors')
        .withIndex('by_userId_chatroomId', (q: any) =>
          q.eq('userId', login.userId!).eq('chatroomId', chatroomId)
        )
        .first();
    });
    expect(cursorAfter?.lastSeenAt).toBe(cursorBefore?.lastSeenAt);
  });

  test('handoff-to-user with empty queue sets hasUnreadHandoff', async () => {
    const { sessionId } = await createTestSession('test-unread-handoff-empty');
    const chatroomId = await createBuilderEntryDuoChatroom(sessionId);
    await joinParticipant(sessionId, chatroomId, 'builder');

    await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      senderRole: 'user',
      content: 'only message',
      type: 'message',
    });

    await t.mutation(api.tasks.claimTask, { sessionId, chatroomId, role: 'builder' });
    const acknowledgedTask = await t.run(async (ctx) => {
      return ctx.db
        .query('chatroom_tasks')
        .withIndex('by_chatroom_status', (q) =>
          q.eq('chatroomId', chatroomId).eq('status', 'acknowledged')
        )
        .first();
    });
    expect(acknowledgedTask).not.toBeNull();
    await t.mutation(api.tasks.readTask, {
      sessionId,
      chatroomId,
      role: 'builder',
      taskId: acknowledgedTask!._id,
    });

    await t.mutation(api.messages.handoff, {
      sessionId,
      chatroomId,
      senderRole: 'builder',
      targetRole: 'user',
      content: 'All done',
    });

    const status = await t.run(async (ctx) => {
      const chatroom = await ctx.db.get('chatroom_rooms', chatroomId);
      return await ctx.db
        .query('chatroom_unreadStatus')
        .withIndex('by_userId_chatroomId', (q: any) =>
          q.eq('userId', chatroom!.ownerId).eq('chatroomId', chatroomId)
        )
        .first();
    });

    expect(status).not.toBeNull();
    expect(status!.hasUnread).toBe(true);
    expect(status!.hasUnreadHandoff).toBe(true);
  });
});
