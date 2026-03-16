/**
 * Tests for promote-queued-message use case.
 * Verifies that queued messages are correctly promoted:
 * - message copied from chatroom_messageQueue to chatroom_messages
 * - a new task created with status 'pending'
 * - queue record deleted
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { api } from '../../../../convex/_generated/api';
import type { Id } from '../../../../convex/_generated/dataModel';
import { t } from '../../../../test.setup';
import { promoteQueuedMessage } from './promote-queued-message';

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

async function createQueueRecord(
  chatroomId: Id<'chatroom_rooms'>,
  content = 'queued message content'
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

describe('promoteQueuedMessage', () => {
  test('creates a chatroom_messages record from queue data', async () => {
    const { sessionId } = await createTestSession('promote-msg-1');
    const chatroomId = await createChatroom(sessionId);

    const queuedMessageId = await createQueueRecord(chatroomId);

    const result = await t.run(async (ctx) => {
      return await promoteQueuedMessage(ctx, queuedMessageId);
    });

    expect(result).toBeDefined();
    expect(result).not.toBeNull();
    expect(result?.messageId).toBeDefined();

    const message = await t.run(async (ctx) => {
      return await ctx.db.get('chatroom_messages', result!.messageId);
    });

    expect(message).toBeDefined();
    expect(message?.content).toBe('queued message content');
    expect(message?.senderRole).toBe('user');
    expect(message?.targetRole).toBe('builder');
  });

  test('creates a new task with status pending', async () => {
    const { sessionId } = await createTestSession('promote-msg-2');
    const chatroomId = await createChatroom(sessionId);

    const queuedMessageId = await createQueueRecord(chatroomId);

    const result = await t.run(async (ctx) => {
      return await promoteQueuedMessage(ctx, queuedMessageId);
    });

    expect(result?.taskId).toBeDefined();

    const task = await t.run(async (ctx) => {
      return await ctx.db.get('chatroom_tasks', result!.taskId);
    });

    expect(task).toBeDefined();
    expect(task?.status).toBe('pending');
    expect(task?.content).toBe('queued message content');
  });

  test('links message and task bidirectionally', async () => {
    const { sessionId } = await createTestSession('promote-msg-3');
    const chatroomId = await createChatroom(sessionId);

    const queuedMessageId = await createQueueRecord(chatroomId);

    const result = await t.run(async (ctx) => {
      return await promoteQueuedMessage(ctx, queuedMessageId);
    });

    const message = await t.run(async (ctx) => {
      return await ctx.db.get('chatroom_messages', result!.messageId);
    });
    const task = await t.run(async (ctx) => {
      return await ctx.db.get('chatroom_tasks', result!.taskId);
    });

    expect(message?.taskId).toBe(result!.taskId);
    expect(task?.sourceMessageId).toBe(result!.messageId);
  });

  test('deletes queue record after successful promotion', async () => {
    const { sessionId } = await createTestSession('promote-msg-4');
    const chatroomId = await createChatroom(sessionId);

    const queuedMessageId = await createQueueRecord(chatroomId);

    // Verify queue record exists before promotion
    const queueRecordBefore = await t.run(async (ctx) => {
      return await ctx.db.get('chatroom_messageQueue', queuedMessageId);
    });
    expect(queueRecordBefore).toBeDefined();

    // Promote
    await t.run(async (ctx) => {
      return await promoteQueuedMessage(ctx, queuedMessageId);
    });

    // Verify queue record is deleted
    const queueRecordAfter = await t.run(async (ctx) => {
      return await ctx.db.get('chatroom_messageQueue', queuedMessageId);
    });
    expect(queueRecordAfter).toBeNull();
  });

  test('returns null if queue record does not exist', async () => {
    const { sessionId } = await createTestSession('promote-msg-5');
    const chatroomId = await createChatroom(sessionId);

    // Create a queue record, then delete it so we have a valid-format ID that no longer exists
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

    const result = await t.run(async (ctx) => {
      return await promoteQueuedMessage(ctx, deletedId);
    });

    expect(result).toBeNull();
  });
});
