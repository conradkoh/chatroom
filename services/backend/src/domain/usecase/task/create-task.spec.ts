/**
 * Tests for create-task use case — verifies shouldEnqueueMessage logic.
 * shouldEnqueueMessage returns true if an active/in-progress task exists (message should be queued),
 * or false if no active task exists (message can be sent directly).
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { api } from '../../../../convex/_generated/api';
import type { Id } from '../../../../convex/_generated/dataModel';
import { t } from '../../../../test.setup';
import { shouldEnqueueMessage } from './create-task';

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

async function seedTask(
  chatroomId: Id<'chatroom_rooms'>,
  status: 'pending' | 'in_progress' | 'completed'
) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    return await ctx.db.insert('chatroom_tasks', {
      chatroomId,
      createdBy: 'user',
      content: 'test task',
      status,
      createdAt: now,
      updatedAt: now,
      queuePosition: 0,
    });
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('shouldEnqueueMessage', () => {
  test('returns false when no active tasks exist', async () => {
    const { sessionId } = await createTestSession('det-status-1');
    const chatroomId = await createChatroom(sessionId);

    const enqueue = await t.run(async (ctx) => {
      return await shouldEnqueueMessage(ctx, chatroomId);
    });

    expect(enqueue).toBe(false);
  });

  test('returns true when a pending task exists', async () => {
    const { sessionId } = await createTestSession('det-status-2');
    const chatroomId = await createChatroom(sessionId);

    await seedTask(chatroomId, 'pending');

    const enqueue = await t.run(async (ctx) => {
      return await shouldEnqueueMessage(ctx, chatroomId);
    });

    expect(enqueue).toBe(true);
  });

  test('returns true when an in_progress task exists', async () => {
    const { sessionId } = await createTestSession('det-status-3');
    const chatroomId = await createChatroom(sessionId);

    await seedTask(chatroomId, 'in_progress');

    const enqueue = await t.run(async (ctx) => {
      return await shouldEnqueueMessage(ctx, chatroomId);
    });

    expect(enqueue).toBe(true);
  });

  test('returns true when both pending and in_progress tasks exist', async () => {
    const { sessionId } = await createTestSession('det-status-4');
    const chatroomId = await createChatroom(sessionId);

    await seedTask(chatroomId, 'pending');
    await seedTask(chatroomId, 'in_progress');

    const enqueue = await t.run(async (ctx) => {
      return await shouldEnqueueMessage(ctx, chatroomId);
    });

    expect(enqueue).toBe(true);
  });

  test('returns false when only completed tasks exist', async () => {
    const { sessionId } = await createTestSession('det-status-5');
    const chatroomId = await createChatroom(sessionId);

    await seedTask(chatroomId, 'completed');
    await seedTask(chatroomId, 'completed');

    const enqueue = await t.run(async (ctx) => {
      return await shouldEnqueueMessage(ctx, chatroomId);
    });

    expect(enqueue).toBe(false);
  });

  test('returns true when an acknowledged task exists', async () => {
    const { sessionId } = await createTestSession('det-status-6');
    const chatroomId = await createChatroom(sessionId);

    // Insert an acknowledged task directly (simulating agent having called get-next-task)
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert('chatroom_tasks', {
        chatroomId,
        createdBy: 'user',
        content: 'test task',
        status: 'acknowledged',
        createdAt: now,
        updatedAt: now,
        queuePosition: 0,
      });
    });

    const enqueue = await t.run(async (ctx) => {
      return await shouldEnqueueMessage(ctx, chatroomId);
    });

    expect(enqueue).toBe(true);
  });
});
