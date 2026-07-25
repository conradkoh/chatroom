import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { t } from '../../../../test.setup';
import { api } from '../../../../convex/_generated/api';
import type { Doc, Id } from '../../../../convex/_generated/dataModel';

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

describe('lifecycle impacts', () => {
  test('getChatroomLifecycleImpacts counts only active prompts', async () => {
    const { sessionId, userId } = await createTestSession('li-count-active');
    const chatroomId = await createChatroom(sessionId);

    const now = Date.now();
    await t.run(async (ctx: any) => {
      await ctx.db.insert('chatroom_scheduledPrompts', {
        chatroomId,
        prompt: 'active 1',
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
        prompt: 'active 2',
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
      await ctx.db.insert('chatroom_scheduledPrompts', {
        chatroomId,
        prompt: 'user disabled',
        scheduleKind: 'interval',
        intervalMinutes: 10,
        disabledReason: 'user',
        isRunnable: false,
        createdBy: userId,
        createdAt: now,
        updatedAt: now,
      });
    });

    const result = await t.query(api.chatrooms.getLifecycleImpacts, {
      sessionId,
      chatroomId,
      action: 'archive',
    });
    expect(result.impacts).toEqual([{ kind: 'scheduled_prompt', count: 2 }]);
  });

  test('getChatroomLifecycleImpacts returns empty when no active prompts', async () => {
    const { sessionId, userId } = await createTestSession('li-no-active');
    const chatroomId = await createChatroom(sessionId);

    const now = Date.now();
    await t.run(async (ctx: any) => {
      await ctx.db.insert('chatroom_scheduledPrompts', {
        chatroomId,
        prompt: 'user disabled',
        scheduleKind: 'interval',
        intervalMinutes: 10,
        disabledReason: 'user',
        isRunnable: false,
        createdBy: userId,
        createdAt: now,
        updatedAt: now,
      });
    });

    const result = await t.query(api.chatrooms.getLifecycleImpacts, {
      sessionId,
      chatroomId,
      action: 'archive',
    });
    expect(result.impacts).toEqual([]);
  });

  test('disableScheduledPromptsForArchive sets archive on active only', async () => {
    const { sessionId, userId } = await createTestSession('li-disable-archive');
    const chatroomId = await createChatroom(sessionId);

    const now = Date.now();
    await t.run(async (ctx: any) => {
      await ctx.db.insert('chatroom_scheduledPrompts', {
        chatroomId,
        prompt: 'active',
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
        prompt: 'user disabled',
        scheduleKind: 'interval',
        intervalMinutes: 10,
        disabledReason: 'user',
        isRunnable: false,
        createdBy: userId,
        createdAt: now,
        updatedAt: now,
      });
    });

    // Use the archive mutation to test disableScheduledPromptsForArchive
    await t.mutation(api.chatrooms.archive, {
      sessionId,
      chatroomId,
    });

    const prompts: Doc<'chatroom_scheduledPrompts'>[] = await t.run(async (ctx: any) => {
      return await ctx.db
        .query('chatroom_scheduledPrompts')
        .withIndex('by_chatroom', (q: any) => q.eq('chatroomId', chatroomId))
        .collect();
    });
    const active = prompts.find((p) => p.prompt === 'active');
    expect(active).toBeDefined();
    expect(active!.disabledReason).toBe('archive');
    expect(active!.isRunnable).toBe(false);

    const userDisabled = prompts.find((p) => p.prompt === 'user disabled');
    expect(userDisabled).toBeDefined();
    expect(userDisabled!.disabledReason).toBe('user');
    expect(userDisabled!.isRunnable).toBe(false);
  });
});
