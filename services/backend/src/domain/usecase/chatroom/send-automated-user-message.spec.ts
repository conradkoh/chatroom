/**
 * Tests for sendAutomatedUserMessage use case.
 * Verifies that explicit conversationMode snapshots are persisted correctly
 * on both direct (non-queued) and queued message/task paths, and that
 * legacy/no-mode callers retain live-config fallback behaviour.
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { api } from '../../../../convex/_generated/api';
import type { Id } from '../../../../convex/_generated/dataModel';
import { t } from '../../../../test.setup';

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
    teamName: 'Duo Team',
    teamRoles: ['planner', 'builder'],
    teamEntryPoint: 'planner',
  });
}

async function seedActiveTask(chatroomId: Id<'chatroom_rooms'>) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const taskId = await ctx.db.insert('chatroom_tasks', {
      chatroomId,
      createdBy: 'user',
      content: 'active task',
      status: 'in_progress',
      createdAt: now,
      updatedAt: now,
      queuePosition: 0,
    });
    await ctx.db.insert('chatroom_taskCounts', {
      chatroomId,
      pending: 0,
      acknowledged: 0,
      inProgress: 1,
      completed: 0,
      queueSize: 0,
      backlogCount: 0,
      pendingReviewCount: 0,
    });
    return taskId;
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('sendAutomatedUserMessage — explicit conversationMode', () => {
  test('direct send with mode=chat persists conversationMode and plannerEnhancerEnabled=false', async () => {
    const { sessionId } = await createTestSession('auto-chat-direct');
    const chatroomId = await createChatroom(sessionId);

    const messageId = await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      senderRole: 'user',
      content: 'chat mode message',
      type: 'message',
      conversationMode: 'chat',
    });

    // Verify the message was written to chatroom_messages (not queued)
    const message = await t.run(async (ctx) => {
      return await ctx.db.get('chatroom_messages', messageId as Id<'chatroom_messages'>);
    });
    expect(message).toBeDefined();
    expect(message?.content).toBe('chat mode message');

    // Verify the task has the mode snapshot
    const task = await t.run(async (ctx) => {
      return await ctx.db
        .query('chatroom_tasks')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .first();
    });
    expect(task?.conversationMode).toBe('chat');
    expect(task?.plannerEnhancerEnabled).toBe(false);
  });

  test('direct send with mode=code persists conversationMode and plannerEnhancerEnabled=false', async () => {
    const { sessionId } = await createTestSession('auto-code-direct');
    const chatroomId = await createChatroom(sessionId);

    const messageId = await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      senderRole: 'user',
      content: 'code mode message',
      type: 'message',
      conversationMode: 'code',
    });

    const message = await t.run(async (ctx) => {
      return await ctx.db.get('chatroom_messages', messageId as Id<'chatroom_messages'>);
    });
    expect(message).toBeDefined();

    const task = await t.run(async (ctx) => {
      return await ctx.db
        .query('chatroom_tasks')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .first();
    });
    expect(task?.conversationMode).toBe('code');
    expect(task?.plannerEnhancerEnabled).toBe(false);
  });

  test('direct send with mode=code:enhanced persists conversationMode and plannerEnhancerEnabled=true', async () => {
    const { sessionId } = await createTestSession('auto-enhanced-direct');
    const chatroomId = await createChatroom(sessionId);

    const messageId = await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      senderRole: 'user',
      content: 'enhanced mode message',
      type: 'message',
      conversationMode: 'code:enhanced',
    });

    const message = await t.run(async (ctx) => {
      return await ctx.db.get('chatroom_messages', messageId as Id<'chatroom_messages'>);
    });
    expect(message).toBeDefined();

    const task = await t.run(async (ctx) => {
      return await ctx.db
        .query('chatroom_tasks')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .first();
    });
    expect(task?.conversationMode).toBe('code:enhanced');
    expect(task?.plannerEnhancerEnabled).toBe(true);
  });

  test('queued send with explicit mode persists conversationMode on queue row', async () => {
    const { sessionId } = await createTestSession('auto-chat-queued');
    const chatroomId = await createChatroom(sessionId);
    await seedActiveTask(chatroomId);

    const returnedId = await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      senderRole: 'user',
      content: 'queued chat mode',
      type: 'message',
      conversationMode: 'chat',
    });

    // Verify queued message has conversationMode
    const queuedMsg = await t.run(async (ctx) => {
      return await ctx.db.get('chatroom_messageQueue', returnedId as Id<'chatroom_messageQueue'>);
    });
    expect(queuedMsg).toBeDefined();
    expect(queuedMsg?.conversationMode).toBe('chat');
    expect(queuedMsg?.plannerEnhancerEnabled).toBe(false);
  });

  test('legacy send without mode retains live-config fallback (no conversationMode persisted)', async () => {
    const { sessionId } = await createTestSession('auto-legacy-direct');
    const chatroomId = await createChatroom(sessionId);

    await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      senderRole: 'user',
      content: 'legacy mode message',
      type: 'message',
      // No conversationMode — should use live-config fallback
    });

    const task = await t.run(async (ctx) => {
      return await ctx.db
        .query('chatroom_tasks')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .first();
    });
    // Without a user enhancer config, plannerEnhancerEnabled defaults to undefined/false
    expect(task?.conversationMode).toBeUndefined();
  });
});
