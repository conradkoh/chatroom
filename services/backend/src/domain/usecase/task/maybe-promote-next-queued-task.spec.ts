/**
 * Unit tests for maybePromoteNextQueuedTask — seeded DB via t.run.
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { maybePromoteNextQueuedTask } from './maybe-promote-next-queued-task';
import { api } from '../../../../convex/_generated/api';
import type { Id } from '../../../../convex/_generated/dataModel';
import { t } from '../../../../test.setup';

async function createTestSession(id: string) {
  const login = await t.mutation(api.auth.loginAnon, { sessionId: id as SessionId });
  expect(login.success).toBe(true);
  return { sessionId: id as SessionId };
}

async function createBuilderEntryChatroom(sessionId: SessionId): Promise<Id<'chatroom_rooms'>> {
  return await t.mutation(api.chatrooms.create, {
    sessionId,
    teamId: 'duo',
    teamName: 'Duo Team',
    teamRoles: ['planner', 'builder'],
    teamEntryPoint: 'builder',
  });
}

async function insertQueueRecord(chatroomId: Id<'chatroom_rooms'>, content: string): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert('chatroom_messageQueue', {
      chatroomId,
      senderRole: 'user',
      targetRole: 'builder',
      content,
      type: 'message',
      queuePosition: 1,
    });
  });
}

describe('maybePromoteNextQueuedTask', () => {
  test('promotes when queue has messages and no active tasks', async () => {
    const { sessionId } = await createTestSession('maybe-promote-1');
    const chatroomId = await createBuilderEntryChatroom(sessionId);
    await insertQueueRecord(chatroomId, 'Queued work');

    const result = await t.run(async (ctx) => {
      return await maybePromoteNextQueuedTask(ctx, chatroomId);
    });

    expect(result).toEqual({
      promoted: expect.any(String),
      reason: 'success',
    });

    await t.run(async (ctx) => {
      const pending = await ctx.db
        .query('chatroom_tasks')
        .withIndex('by_chatroom_status', (q) =>
          q.eq('chatroomId', chatroomId).eq('status', 'pending')
        )
        .collect();
      expect(pending).toHaveLength(1);
      expect(pending[0]?.content).toBe('Queued work');
    });
  });

  test('returns active_task_exists when acknowledged task present', async () => {
    const { sessionId } = await createTestSession('maybe-promote-2');
    const chatroomId = await createBuilderEntryChatroom(sessionId);
    await insertQueueRecord(chatroomId, 'Should not promote');

    const { taskId } = await t.mutation(api.tasks.createTask, {
      sessionId,
      chatroomId,
      content: 'Active task',
      createdBy: 'user',
    });
    await t.mutation(api.tasks.claimTask, {
      sessionId,
      chatroomId,
      role: 'builder',
      taskId,
    });

    const result = await t.run(async (ctx) => {
      return await maybePromoteNextQueuedTask(ctx, chatroomId);
    });

    expect(result).toEqual({ promoted: null, reason: 'active_task_exists' });
  });

  test('returns skipped_not_entry_point when entryPointRole !== team entry point', async () => {
    const { sessionId } = await createTestSession('maybe-promote-3');
    const chatroomId = await createBuilderEntryChatroom(sessionId);
    await insertQueueRecord(chatroomId, 'Planner cannot promote');

    const result = await t.run(async (ctx) => {
      return await maybePromoteNextQueuedTask(ctx, chatroomId, {
        entryPointRole: 'planner',
      });
    });

    expect(result).toEqual({ promoted: null, reason: 'skipped_not_entry_point' });

    await t.run(async (ctx) => {
      const queue = await ctx.db
        .query('chatroom_messageQueue')
        .withIndex('by_chatroom_queue', (q) => q.eq('chatroomId', chatroomId))
        .collect();
      expect(queue).toHaveLength(1);
    });
  });

  test('promotes when entryPointRole matches team entry point', async () => {
    const { sessionId } = await createTestSession('maybe-promote-4');
    const chatroomId = await createBuilderEntryChatroom(sessionId);
    await insertQueueRecord(chatroomId, 'Builder entry promotes');

    const result = await t.run(async (ctx) => {
      return await maybePromoteNextQueuedTask(ctx, chatroomId, {
        entryPointRole: 'builder',
      });
    });

    expect(result).toEqual({
      promoted: expect.any(String),
      reason: 'success',
    });
  });
});
