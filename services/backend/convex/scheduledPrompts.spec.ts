/**
 * Integration tests for scheduled prompts.
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

describe('scheduled prompts', () => {
  test('create validates minimum interval', async () => {
    const { sessionId } = await createTestSession('sp-min-interval');
    const chatroomId = await createChatroom(sessionId);

    await expect(
      t.mutation(api.scheduledPrompts.create, {
        sessionId,
        chatroomId,
        prompt: 'daily standup',
        scheduleKind: 'interval',
        intervalMinutes: 0,
      })
    ).rejects.toThrow();
  });

  test('setEnabled(false) sets isRunnable: false and clears nextRunAt', async () => {
    const { sessionId } = await createTestSession('sp-set-enabled');
    const chatroomId = await createChatroom(sessionId);

    const id = await t.mutation(api.scheduledPrompts.create, {
      sessionId,
      chatroomId,
      prompt: 'daily standup',
      scheduleKind: 'daily',
      hourUTC: 9,
      minuteUTC: 0,
    });

    await t.mutation(api.scheduledPrompts.setEnabled, {
      sessionId,
      scheduledPromptId: id as Id<'chatroom_scheduledPrompts'>,
      enabled: false,
    });

    const row = await t.run(async (ctx) => {
      return await ctx.db.get('chatroom_scheduledPrompts', id as Id<'chatroom_scheduledPrompts'>);
    });
    expect(row).toBeDefined();
    expect(row!.isRunnable).toBe(false);
    expect(row!.nextRunAt).toBeUndefined();
    expect(row!.disabledReason).toBe('user');
  });

  test('setEnabled(true) on archive-held row throws LIFECYCLE_DISABLED', async () => {
    const { sessionId, userId } = await createTestSession('sp-archive-hold');
    const chatroomId = await createChatroom(sessionId);

    // Seed a prompt row with disabledReason: 'archive'
    const id = await t.run(async (ctx) => {
      return await ctx.db.insert('chatroom_scheduledPrompts', {
        chatroomId,
        prompt: 'archived prompt',
        scheduleKind: 'daily',
        hourUTC: 10,
        minuteUTC: 0,
        disabledReason: 'archive',
        isRunnable: false,
        createdBy: userId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    await expect(
      t.mutation(api.scheduledPrompts.setEnabled, {
        sessionId,
        scheduledPromptId: id as Id<'chatroom_scheduledPrompts'>,
        enabled: true,
      })
    ).rejects.toThrow();
  });

  test('fireOne sends message with sourcePlatform scheduled and creates task', async () => {
    const { sessionId, userId } = await createTestSession('sp-fire-one');
    const chatroomId = await createChatroom(sessionId);

    const now = Date.now();
    const id = await t.run(async (ctx) => {
      return await ctx.db.insert('chatroom_scheduledPrompts', {
        chatroomId,
        prompt: 'scheduled message',
        scheduleKind: 'interval',
        intervalMinutes: 30,
        disabledReason: undefined,
        isRunnable: true,
        nextRunAt: now - 1000, // overdue
        createdBy: userId,
        createdAt: now,
        updatedAt: now,
      });
    });

    await t.mutation(api.scheduledPrompts.fireOne as any, {
      scheduledPromptId: id,
    });

    // Verify a message was created with sourcePlatform: 'scheduled'
    const messages = await t.run(async (ctx) => {
      return await ctx.db
        .query('chatroom_messages')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .collect();
    });
    expect(messages.length).toBeGreaterThanOrEqual(1);
    const msg = messages.find((m) => m.sourcePlatform === 'scheduled');
    expect(msg).toBeDefined();
    expect(msg!.content).toBe('scheduled message');
    expect(msg!.senderRole).toBe('user');
    expect(msg!.taskId).toBeDefined();

    // Verify prompt row has updated nextRunAt
    const row = await t.run(async (ctx) => {
      return await ctx.db.get('chatroom_scheduledPrompts', id as Id<'chatroom_scheduledPrompts'>);
    });
    expect(row).toBeDefined();
    expect(row!.lastRunAt).toBeGreaterThanOrEqual(now);
    expect(row!.nextRunAt).toBeGreaterThan(now);
  });

  test('fireOne creates message with scheduledPromptId and sourcePlatform', async () => {
    const { sessionId, userId } = await createTestSession('sp-fire-one-link');
    const chatroomId = await createChatroom(sessionId);

    const now = Date.now();
    const id = await t.run(async (ctx) => {
      return await ctx.db.insert('chatroom_scheduledPrompts', {
        chatroomId,
        prompt: 'linked scheduled message',
        scheduleKind: 'interval',
        intervalMinutes: 30,
        disabledReason: undefined,
        isRunnable: true,
        nextRunAt: now - 1000,
        createdBy: userId,
        createdAt: now,
        updatedAt: now,
      });
    });

    await t.mutation(api.scheduledPrompts.fireOne as any, {
      scheduledPromptId: id,
    });

    const messages = await t.run(async (ctx) => {
      return await ctx.db
        .query('chatroom_messages')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .collect();
    });
    expect(messages.length).toBeGreaterThanOrEqual(1);
    const msg = messages.find((m) => m.sourcePlatform === 'scheduled');
    expect(msg).toBeDefined();
    expect(msg!.content).toBe('linked scheduled message');
    expect(msg!.sourcePlatform).toBe('scheduled');
    expect(msg!.scheduledPromptId).toBe(id);
  });

  test('listTriggeredMessages returns messages linked to prompt, ordered desc', async () => {
    const { sessionId, userId } = await createTestSession('sp-list-triggered');
    const chatroomId = await createChatroom(sessionId);

    const now = Date.now();
    const id = await t.run(async (ctx) => {
      return await ctx.db.insert('chatroom_scheduledPrompts', {
        chatroomId,
        prompt: 'list test prompt',
        scheduleKind: 'interval',
        intervalMinutes: 30,
        disabledReason: undefined,
        isRunnable: true,
        nextRunAt: now + 60000,
        createdBy: userId,
        createdAt: now,
        updatedAt: now,
      });
    });

    // Insert two messages linked to the prompt (no createdAt — uses _creationTime)
    await Promise.all([
      t.run(async (ctx) => {
        await ctx.db.insert('chatroom_messages', {
          chatroomId,
          senderRole: 'user',
          content: 'first',
          type: 'message',
          scheduledPromptId: id,
        });
      }),
      // Small delay so _creationTime order differs
      new Promise((r) => setTimeout(r, 5)),
    ]);
    await t.run(async (ctx) => {
      await ctx.db.insert('chatroom_messages', {
        chatroomId,
        senderRole: 'user',
        content: 'second',
        type: 'message',
        scheduledPromptId: id,
      });
    });

    const result = await t.query(api.scheduledPrompts.listTriggeredMessages, {
      sessionId,
      scheduledPromptId: id,
      limit: 10,
    });

    expect(result).toHaveLength(2);
    expect(result[0].content).toBe('second');
    expect(result[1].content).toBe('first');
  });

  test('listTriggeredMessages access denied for wrong session', async () => {
    const { sessionId, userId } = await createTestSession('sp-list-denied');
    const { sessionId: otherSession } = await createTestSession('sp-list-denied-other');
    const chatroomId = await createChatroom(sessionId);

    const now = Date.now();
    const id = await t.run(async (ctx) => {
      return await ctx.db.insert('chatroom_scheduledPrompts', {
        chatroomId,
        prompt: 'denied prompt',
        scheduleKind: 'interval',
        intervalMinutes: 30,
        disabledReason: undefined,
        isRunnable: true,
        nextRunAt: now + 60000,
        createdBy: userId,
        createdAt: now,
        updatedAt: now,
      });
    });

    await expect(
      t.query(api.scheduledPrompts.listTriggeredMessages, {
        sessionId: otherSession,
        scheduledPromptId: id,
      })
    ).rejects.toThrow();
  });

  test('fireOne sets nextRunAt from scheduled anchor not execution time', async () => {
    const { sessionId, userId } = await createTestSession('sp-anchor');
    const chatroomId = await createChatroom(sessionId);

    const scheduledAt = Date.now() - 5000;
    const intervalMs = 60_000;
    const id = await t.run(async (ctx) => {
      return await ctx.db.insert('chatroom_scheduledPrompts', {
        chatroomId,
        prompt: 'anchor test',
        scheduleKind: 'interval',
        intervalMinutes: 1,
        isRunnable: true,
        nextRunAt: scheduledAt,
        createdBy: userId,
        createdAt: scheduledAt,
        updatedAt: scheduledAt,
      });
    });

    await t.mutation(api.scheduledPrompts.fireOne as any, { scheduledPromptId: id });

    const row = await t.run(async (ctx) =>
      ctx.db.get('chatroom_scheduledPrompts', id as Id<'chatroom_scheduledPrompts'>)
    );
    expect(row!.nextRunAt).toBe(scheduledAt + intervalMs);
    expect(row!.nextRunAt).toBeLessThan(Date.now() + intervalMs - 4000);
  });

  test('setEnabled(true) preserves interval cadence from lastRunAt', async () => {
    const { sessionId } = await createTestSession('sp-reenable');
    const chatroomId = await createChatroom(sessionId);

    const intervalMs = 60_000;
    const lastRunAt = Date.now() - 30_000;

    const id = await t.mutation(api.scheduledPrompts.create, {
      sessionId,
      chatroomId,
      prompt: 'reenable test',
      scheduleKind: 'interval',
      intervalMinutes: 1,
    });

    // Seed lastRunAt with a cadence-aligned nextRunAt that hasn't fired yet
    await t.run(async (ctx) => {
      await ctx.db.patch('chatroom_scheduledPrompts', id as Id<'chatroom_scheduledPrompts'>, {
        lastRunAt,
        nextRunAt: lastRunAt + intervalMs,
      });
    });

    // Disable then re-enable (simulates user toggling off/on before next slot)
    await t.mutation(api.scheduledPrompts.setEnabled, {
      sessionId,
      scheduledPromptId: id as Id<'chatroom_scheduledPrompts'>,
      enabled: false,
    });

    await t.mutation(api.scheduledPrompts.setEnabled, {
      sessionId,
      scheduledPromptId: id as Id<'chatroom_scheduledPrompts'>,
      enabled: true,
    });

    const row = await t.run(async (ctx) =>
      ctx.db.get('chatroom_scheduledPrompts', id as Id<'chatroom_scheduledPrompts'>)
    );
    expect(row!.isRunnable).toBe(true);
    expect(row!.disabledReason).toBeUndefined();
    // Must preserve cadence: next slot is lastRunAt + interval, NOT now + interval
    expect(row!.nextRunAt).toBe(lastRunAt + intervalMs);
  });

  test('runDue does not pick up isRunnable: false rows', async () => {
    const { sessionId, userId } = await createTestSession('sp-run-due-skip');
    const chatroomId = await createChatroom(sessionId);

    const now = Date.now();
    // Seed a disabled row with past nextRunAt
    await t.run(async (ctx) => {
      await ctx.db.insert('chatroom_scheduledPrompts', {
        chatroomId,
        prompt: 'should not fire',
        scheduleKind: 'interval',
        intervalMinutes: 10,
        disabledReason: 'user',
        isRunnable: false,
        nextRunAt: now - 5000,
        createdBy: userId,
        createdAt: now,
        updatedAt: now,
      });
    });

    // runDue should not throw and should not process the disabled row
    await t.mutation(api.scheduledPrompts.runDue as any, {});

    // Verify no message was created
    const messages = await t.run(async (ctx) => {
      return await ctx.db
        .query('chatroom_messages')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .collect();
    });
    expect(messages).toHaveLength(0);
  });
});
