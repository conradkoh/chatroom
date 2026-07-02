/**
 * Unit tests for getChatroomQueueState
 * Covers materialized counts path, queue cross-check, and fallback when counts doc missing.
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { getChatroomQueueState } from './chatroom-queue-state';
import { api } from '../../../../convex/_generated/api';
import type { Id } from '../../../../convex/_generated/dataModel';
import { t } from '../../../../test.setup';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createTestSession(id: string) {
  const login = await t.mutation(api.auth.loginAnon, { sessionId: id as SessionId });
  expect(login.success).toBe(true);
  return { sessionId: id as SessionId };
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
  status: 'pending' | 'acknowledged' | 'in_progress' | 'completed',
  opts?: { assignedTo?: string }
) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    return await ctx.db.insert('chatroom_tasks', {
      chatroomId,
      createdBy: 'user',
      content: 'test task',
      status,
      assignedTo: opts?.assignedTo,
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

async function seedQueueRow(chatroomId: Id<'chatroom_rooms'>, queuePosition = 1) {
  await t.run(async (ctx) => {
    await ctx.db.insert('chatroom_messageQueue', {
      chatroomId,
      senderRole: 'user',
      targetRole: 'planner',
      content: 'queued message',
      type: 'message',
      queuePosition,
    });
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('getChatroomQueueState — materialized counts path', () => {
  test('returns isWorkQueueEmpty true when no active tasks and no queued messages', async () => {
    const { sessionId } = await createTestSession('cqs-mat-empty');
    const chatroomId = await createChatroom(sessionId);
    await seedMaterializedCounts(chatroomId, {});

    const state = await t.run(async (ctx) => getChatroomQueueState(ctx, chatroomId));

    expect(state).toEqual({
      hasActiveTask: false,
      hasQueuedMessages: false,
      isWorkQueueEmpty: true,
    });
  });

  test('returns hasActiveTask true when pending > 0', async () => {
    const { sessionId } = await createTestSession('cqs-mat-pending');
    const chatroomId = await createChatroom(sessionId);
    await seedMaterializedCounts(chatroomId, { pending: 1 });
    await seedTask(chatroomId, 'pending');

    const state = await t.run(async (ctx) => getChatroomQueueState(ctx, chatroomId));

    expect(state.hasActiveTask).toBe(true);
    expect(state.isWorkQueueEmpty).toBe(false);
  });

  test('returns hasQueuedMessages true when queue row exists even if queueSize is 0 (stale count)', async () => {
    const { sessionId } = await createTestSession('cqs-mat-stale-queue');
    const chatroomId = await createChatroom(sessionId);
    await seedMaterializedCounts(chatroomId, { queueSize: 0 });
    await seedQueueRow(chatroomId);

    const state = await t.run(async (ctx) => getChatroomQueueState(ctx, chatroomId));

    expect(state.hasQueuedMessages).toBe(true);
    expect(state.isWorkQueueEmpty).toBe(false);
  });

  test('returns hasQueuedMessages false when queueSize > 0 but no queue row (stale count)', async () => {
    const { sessionId } = await createTestSession('cqs-mat-stale-size');
    const chatroomId = await createChatroom(sessionId);
    await seedMaterializedCounts(chatroomId, { queueSize: 2 });

    const state = await t.run(async (ctx) => getChatroomQueueState(ctx, chatroomId));

    expect(state.hasQueuedMessages).toBe(false);
    expect(state.isWorkQueueEmpty).toBe(true);
  });

  test('returns isWorkQueueEmpty false when active task exists even without queued messages', async () => {
    const { sessionId } = await createTestSession('cqs-mat-ack');
    const chatroomId = await createChatroom(sessionId);
    await seedMaterializedCounts(chatroomId, { acknowledged: 1 });
    await seedTask(chatroomId, 'acknowledged', { assignedTo: 'builder' });

    const state = await t.run(async (ctx) => getChatroomQueueState(ctx, chatroomId));

    expect(state.hasActiveTask).toBe(true);
    expect(state.hasQueuedMessages).toBe(false);
    expect(state.isWorkQueueEmpty).toBe(false);
  });
});

describe('getChatroomQueueState — fallback path (no materialized doc)', () => {
  test('derives hasActiveTask from source task rows', async () => {
    const { sessionId } = await createTestSession('cqs-fb-active');
    const chatroomId = await createChatroom(sessionId);
    await seedTask(chatroomId, 'pending');

    const state = await t.run(async (ctx) => getChatroomQueueState(ctx, chatroomId));

    expect(state.hasActiveTask).toBe(true);
    expect(state.isWorkQueueEmpty).toBe(false);
  });

  test('derives hasQueuedMessages from messageQueue table', async () => {
    const { sessionId } = await createTestSession('cqs-fb-queue');
    const chatroomId = await createChatroom(sessionId);
    await seedQueueRow(chatroomId);

    const state = await t.run(async (ctx) => getChatroomQueueState(ctx, chatroomId));

    expect(state.hasQueuedMessages).toBe(true);
    expect(state.hasActiveTask).toBe(false);
    expect(state.isWorkQueueEmpty).toBe(false);
  });

  test('returns isWorkQueueEmpty true when no tasks and no queue', async () => {
    const { sessionId } = await createTestSession('cqs-fb-empty');
    const chatroomId = await createChatroom(sessionId);

    const state = await t.run(async (ctx) => getChatroomQueueState(ctx, chatroomId));

    expect(state).toEqual({
      hasActiveTask: false,
      hasQueuedMessages: false,
      isWorkQueueEmpty: true,
    });
  });
});
