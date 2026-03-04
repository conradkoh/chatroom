/**
 * Tests for create-task use case — verifies determineTaskStatus logic.
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { api } from '../../../../convex/_generated/api';
import type { Id } from '../../../../convex/_generated/dataModel';
import { t } from '../../../../test.setup';
import { determineTaskStatus } from './create-task';

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
  status: 'pending' | 'in_progress' | 'queued' | 'completed'
) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    return await ctx.db.insert('chatroom_tasks', {
      chatroomId,
      createdBy: 'user',
      content: 'test task',
      status,
      origin: 'chat',
      createdAt: now,
      updatedAt: now,
      queuePosition: 0,
    });
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('determineTaskStatus', () => {
  test('returns pending when no active or in_progress tasks exist', async () => {
    const { sessionId } = await createTestSession('det-status-1');
    const chatroomId = await createChatroom(sessionId);

    // No tasks seeded — chatroom is empty
    const status = await t.run(async (ctx) => {
      return await determineTaskStatus(ctx, chatroomId);
    });

    expect(status).toBe('pending');
  });

  test('returns queued when a pending task exists', async () => {
    const { sessionId } = await createTestSession('det-status-2');
    const chatroomId = await createChatroom(sessionId);

    // Seed a pending task
    await seedTask(chatroomId, 'pending');

    const status = await t.run(async (ctx) => {
      return await determineTaskStatus(ctx, chatroomId);
    });

    expect(status).toBe('queued');
  });

  test('returns queued when an in_progress task exists', async () => {
    const { sessionId } = await createTestSession('det-status-3');
    const chatroomId = await createChatroom(sessionId);

    // Seed an in_progress task
    await seedTask(chatroomId, 'in_progress');

    const status = await t.run(async (ctx) => {
      return await determineTaskStatus(ctx, chatroomId);
    });

    expect(status).toBe('queued');
  });

  test('returns queued when both pending and in_progress tasks exist', async () => {
    const { sessionId } = await createTestSession('det-status-4');
    const chatroomId = await createChatroom(sessionId);

    // Seed both pending and in_progress tasks
    await seedTask(chatroomId, 'pending');
    await seedTask(chatroomId, 'in_progress');

    const status = await t.run(async (ctx) => {
      return await determineTaskStatus(ctx, chatroomId);
    });

    expect(status).toBe('queued');
  });

  test('returns forceStatus when provided', async () => {
    const { sessionId } = await createTestSession('det-status-5');
    const chatroomId = await createChatroom(sessionId);

    // Seed a pending task (would normally return 'queued')
    await seedTask(chatroomId, 'pending');

    const status = await t.run(async (ctx) => {
      return await determineTaskStatus(ctx, chatroomId, 'backlog');
    });

    expect(status).toBe('backlog');
  });

  test('returns pending when only completed tasks exist', async () => {
    const { sessionId } = await createTestSession('det-status-6');
    const chatroomId = await createChatroom(sessionId);

    // Seed only completed tasks (not active)
    await seedTask(chatroomId, 'completed');
    await seedTask(chatroomId, 'completed');

    const status = await t.run(async (ctx) => {
      return await determineTaskStatus(ctx, chatroomId);
    });

    expect(status).toBe('pending');
  });
});
