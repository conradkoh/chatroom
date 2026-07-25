/**
 * Integration tests for chatroom archive lifecycle.
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { t } from '../test.setup';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';

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

describe('chatroom archive lifecycle', () => {
  test('archive disables prompts and marks chatroom completed', async () => {
    const { sessionId, userId } = await createTestSession('archive-disables-prompts');
    const chatroomId = await createChatroom(sessionId);

    const now = Date.now();
    await t.run(async (ctx) => {
      await ctx.db.insert('chatroom_scheduledPrompts', {
        chatroomId,
        prompt: 'prompt 1',
        scheduleKind: 'interval',
        intervalMinutes: 30,
        disabledReason: undefined,
        isRunnable: true,
        nextRunAt: now + 60_000,
        createdBy: userId,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert('chatroom_scheduledPrompts', {
        chatroomId,
        prompt: 'prompt 2',
        scheduleKind: 'daily',
        hourUTC: 9,
        minuteUTC: 0,
        disabledReason: undefined,
        isRunnable: true,
        nextRunAt: now + 120_000,
        createdBy: userId,
        createdAt: now,
        updatedAt: now,
      });
    });

    const result = await t.mutation(api.chatrooms.archive, {
      sessionId,
      chatroomId,
    });
    expect(result).toEqual({ success: true, disabledPromptCount: 2 });

    // Verify prompts are archived
    const prompts = await t.run(async (ctx) => {
      return await ctx.db
        .query('chatroom_scheduledPrompts')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .collect();
    });
    for (const p of prompts) {
      expect(p.disabledReason).toBe('archive');
      expect(p.isRunnable).toBe(false);
    }

    // Verify chatroom is completed
    const chatroom = await t.run(async (ctx) => {
      return await ctx.db.get('chatroom_rooms', chatroomId);
    });
    expect(chatroom!.status).toBe('completed');
  });

  test('getLifecycleImpacts before and after archive', async () => {
    const { sessionId, userId } = await createTestSession('archive-impacts-before-after');
    const chatroomId = await createChatroom(sessionId);

    const now = Date.now();
    await t.run(async (ctx) => {
      await ctx.db.insert('chatroom_scheduledPrompts', {
        chatroomId,
        prompt: 'active prompt',
        scheduleKind: 'interval',
        intervalMinutes: 30,
        disabledReason: undefined,
        isRunnable: true,
        nextRunAt: now + 60_000,
        createdBy: userId,
        createdAt: now,
        updatedAt: now,
      });
    });

    // Check impacts before archive
    const before = await t.query(api.chatrooms.getLifecycleImpacts, {
      sessionId,
      chatroomId,
      action: 'archive',
    });
    expect(before.impacts).toEqual([{ kind: 'scheduled_prompt', count: 1 }]);

    // Archive
    await t.mutation(api.chatrooms.archive, { sessionId, chatroomId });

    // Check impacts after archive
    const after = await t.query(api.chatrooms.getLifecycleImpacts, {
      sessionId,
      chatroomId,
      action: 'archive',
    });
    expect(after.impacts).toEqual([]);
  });

  test('updateStatus no longer accepts completed', async () => {
    const { sessionId } = await createTestSession('archive-update-status-valid');
    const chatroomId = await createChatroom(sessionId);

    // updateStatus with 'active' still works
    await t.mutation(api.chatrooms.updateStatus, {
      sessionId,
      chatroomId,
      status: 'active',
    });

    // @ts-expect-error — 'completed' is no longer a valid arg
    const promise = t.mutation(api.chatrooms.updateStatus, {
      sessionId,
      chatroomId,
      status: 'completed',
    });
    await expect(promise).rejects.toThrow();
  });
});
