/**
 * Tests for create-task use case — verifies shouldEnqueueMessage logic.
 * shouldEnqueueMessage returns true if an active/in-progress task exists (message should be queued),
 * or false if no active task exists (message can be sent directly).
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { shouldEnqueueMessage, hasActiveTaskFromMaterializedCounts } from './create-task';
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

async function seedTask(
  chatroomId: Id<'chatroom_rooms'>,
  status: 'pending' | 'acknowledged' | 'in_progress' | 'completed'
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

async function seedMaterializedCounts(
  chatroomId: Id<'chatroom_rooms'>,
  counts: Partial<{
    pending: number;
    acknowledged: number;
    inProgress: number;
    completed: number;
    queueSize: number;
    backlogCount: number;
    pendingReviewCount: number;
  }>
) {
  await t.run(async (ctx) => {
    await ctx.db.insert('chatroom_taskCounts', {
      chatroomId,
      pending: 0,
      acknowledged: 0,
      inProgress: 0,
      completed: 0,
      queueSize: 0,
      backlogCount: 0,
      pendingReviewCount: 0,
      ...counts,
    });
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('hasActiveTaskFromMaterializedCounts', () => {
  test('returns false when all active counters are zero', () => {
    expect(
      hasActiveTaskFromMaterializedCounts({ pending: 0, acknowledged: 0, inProgress: 0 })
    ).toBe(false);
  });

  test('returns true when pending > 0', () => {
    expect(
      hasActiveTaskFromMaterializedCounts({ pending: 1, acknowledged: 0, inProgress: 0 })
    ).toBe(true);
  });

  test('returns true when acknowledged > 0', () => {
    expect(
      hasActiveTaskFromMaterializedCounts({ pending: 0, acknowledged: 1, inProgress: 0 })
    ).toBe(true);
  });

  test('returns true when inProgress > 0', () => {
    expect(
      hasActiveTaskFromMaterializedCounts({ pending: 0, acknowledged: 0, inProgress: 1 })
    ).toBe(true);
  });
});

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

  describe('materialized chatroom_taskCounts path', () => {
    test('reconciles stale pending count and returns false when no task rows exist', async () => {
      const { sessionId } = await createTestSession('det-mat-1');
      const chatroomId = await createChatroom(sessionId);

      await seedMaterializedCounts(chatroomId, { pending: 1 });

      const enqueue = await t.run(async (ctx) => {
        return await shouldEnqueueMessage(ctx, chatroomId);
      });

      expect(enqueue).toBe(false);

      const counts = await t.run(async (ctx) => {
        return await ctx.db
          .query('chatroom_taskCounts')
          .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
          .first();
      });
      expect(counts?.pending).toBe(0);
    });

    test('returns true when counts and task rows agree (pending)', async () => {
      const { sessionId } = await createTestSession('det-mat-1b');
      const chatroomId = await createChatroom(sessionId);

      await seedMaterializedCounts(chatroomId, { pending: 1 });
      await seedTask(chatroomId, 'pending');

      const enqueue = await t.run(async (ctx) => {
        return await shouldEnqueueMessage(ctx, chatroomId);
      });

      expect(enqueue).toBe(true);
    });

    test('reconciles stale acknowledged count when no task rows exist', async () => {
      const { sessionId } = await createTestSession('det-mat-2');
      const chatroomId = await createChatroom(sessionId);

      await seedMaterializedCounts(chatroomId, { acknowledged: 1 });

      const enqueue = await t.run(async (ctx) => {
        return await shouldEnqueueMessage(ctx, chatroomId);
      });

      expect(enqueue).toBe(false);

      const counts = await t.run(async (ctx) => {
        return await ctx.db
          .query('chatroom_taskCounts')
          .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
          .first();
      });
      expect(counts?.acknowledged).toBe(0);
    });

    test('reconciles stale inProgress count when no task rows exist', async () => {
      const { sessionId } = await createTestSession('det-mat-3');
      const chatroomId = await createChatroom(sessionId);

      await seedMaterializedCounts(chatroomId, { inProgress: 1 });

      const enqueue = await t.run(async (ctx) => {
        return await shouldEnqueueMessage(ctx, chatroomId);
      });

      expect(enqueue).toBe(false);

      const counts = await t.run(async (ctx) => {
        return await ctx.db
          .query('chatroom_taskCounts')
          .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
          .first();
      });
      expect(counts?.inProgress).toBe(0);
    });

    test('returns false when materialized active counters are all zero', async () => {
      const { sessionId } = await createTestSession('det-mat-4');
      const chatroomId = await createChatroom(sessionId);

      await seedMaterializedCounts(chatroomId, { completed: 5, queueSize: 2 });

      const enqueue = await t.run(async (ctx) => {
        return await shouldEnqueueMessage(ctx, chatroomId);
      });

      expect(enqueue).toBe(false);
    });
  });
});
