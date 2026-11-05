/**
 * Migration: retire the `code:enhanced` conversation mode.
 *
 * Seeds rows that still carry the old mode/preset/phase values, runs each
 * migration through the real migrations component, and asserts the agreed
 * remap. Also asserts clean rows stay byte-identical across a second run, so
 * the migrations are idempotent.
 *
 * This spec is temporary: it is deleted in the slice that narrows the schema.
 */

import type { TaskEnvelopeV1 } from '@workspace/shared/domain/task-envelope';
import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { t } from '../test.setup';
import { api, internal } from './_generated/api';
import type { Id } from './_generated/dataModel';

type MigrationName =
  | 'retireEnhancedModeTasks'
  | 'retireEnhancedModeQueuedMessages'
  | 'retireEnhancedModeScheduledPrompts'
  | 'retireEnhancedModePreferences';

async function seedChatroom(sessionIdString: string) {
  const sessionId = sessionIdString as SessionId;
  const login = await t.mutation(api.auth.loginAnon, { sessionId });
  expect(login.success).toBe(true);
  const chatroomId = await t.run(async (ctx) => {
    return await ctx.db.insert('chatroom_rooms', {
      status: 'active',
      ownerId: login.userId as Id<'users'>,
    });
  });
  return { sessionId, userId: login.userId as Id<'users'>, chatroomId };
}

function enhancedEnvelope(
  phase: 'entry' | 'enhancement' | 'implementation' | 'delivery' = 'enhancement'
): TaskEnvelopeV1 {
  return {
    version: 1,
    conversationMode: 'code:enhanced',
    sessionPolicy: 'continue',
    handoffWorkflow: { preset: 'enhanced-team', phase },
  };
}

function cleanEnvelope(phase: 'entry' | 'implementation' | 'delivery' = 'implementation') {
  return {
    version: 1 as const,
    conversationMode: 'code' as const,
    sessionPolicy: 'continue' as const,
    handoffWorkflow: { preset: 'team' as const, phase },
  };
}

/** Runs one full pass with a fresh cursor so each test exercises every seeded row. */
async function runMigration(name: MigrationName) {
  return await t.mutation(internal.migrations[name], {
    cursor: null,
    batchSize: 100,
    reset: true,
  });
}

async function runAllFour() {
  await runMigration('retireEnhancedModeTasks');
  await runMigration('retireEnhancedModeQueuedMessages');
  await runMigration('retireEnhancedModeScheduledPrompts');
  await runMigration('retireEnhancedModePreferences');
}

function readRows<
  T extends 'chatroom_tasks' | 'chatroom_messageQueue' | 'chatroom_scheduledPrompts',
>(table: T, chatroomId: Id<'chatroom_rooms'>) {
  return t.run(async (ctx) => {
    return await ctx.db
      .query(table)
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
      .collect();
  });
}

function readPreferenceRows(chatroomId: Id<'chatroom_rooms'>) {
  return t.run(async (ctx) => {
    return await ctx.db
      .query('chatroom_conversationModePreferences')
      .withIndex('by_chatroom_user', (q) => q.eq('chatroomId', chatroomId))
      .collect();
  });
}

describe('migration: retire the code:enhanced conversation mode', () => {
  test('retireEnhancedModeTasks remaps mode and envelope and leaves clean tasks untouched', async () => {
    const { chatroomId } = await seedChatroom('migration-retire-enhancement-tasks');
    const now = Date.now();

    const ids = await t.run(async (ctx) => {
      const enhanced = await ctx.db.insert('chatroom_tasks', {
        chatroomId,
        createdBy: 'user',
        content: 'enhanced task',
        status: 'in_progress',
        createdAt: now,
        updatedAt: now,
        queuePosition: 0,
        conversationMode: 'code:enhanced',
        taskEnvelope: enhancedEnvelope(),
      });
      const phaseOnly = await ctx.db.insert('chatroom_tasks', {
        chatroomId,
        createdBy: 'user',
        content: 'phase only task',
        status: 'in_progress',
        createdAt: now,
        updatedAt: now,
        queuePosition: 1,
        conversationMode: 'code',
        taskEnvelope: {
          version: 1,
          conversationMode: 'code',
          sessionPolicy: 'continue',
          handoffWorkflow: { preset: 'team', phase: 'enhancement' },
        },
      });
      const cleanCode = await ctx.db.insert('chatroom_tasks', {
        chatroomId,
        createdBy: 'user',
        content: 'clean code task',
        status: 'in_progress',
        createdAt: now,
        updatedAt: now,
        queuePosition: 2,
        conversationMode: 'code',
        taskEnvelope: cleanEnvelope(),
      });
      const cleanChat = await ctx.db.insert('chatroom_tasks', {
        chatroomId,
        createdBy: 'user',
        content: 'clean chat task',
        status: 'in_progress',
        createdAt: now,
        updatedAt: now,
        queuePosition: 3,
        conversationMode: 'chat',
      });
      return { enhanced, phaseOnly, cleanCode, cleanChat };
    });

    const cleanBefore = await t.run(async (ctx) => ({
      cleanCode: await ctx.db.get('chatroom_tasks', ids.cleanCode),
      cleanChat: await ctx.db.get('chatroom_tasks', ids.cleanChat),
    }));

    await runMigration('retireEnhancedModeTasks');

    const rows = await t.run(async (ctx) => ({
      enhanced: await ctx.db.get('chatroom_tasks', ids.enhanced),
      phaseOnly: await ctx.db.get('chatroom_tasks', ids.phaseOnly),
      cleanCode: await ctx.db.get('chatroom_tasks', ids.cleanCode),
      cleanChat: await ctx.db.get('chatroom_tasks', ids.cleanChat),
    }));

    expect(rows.enhanced?.conversationMode).toBe('code');
    expect(rows.enhanced?.taskEnvelope).toEqual(cleanEnvelope('implementation'));
    expect(rows.phaseOnly?.conversationMode).toBe('code');
    expect(rows.phaseOnly?.taskEnvelope).toEqual(cleanEnvelope('implementation'));
    expect(rows.cleanCode).toEqual(cleanBefore.cleanCode);
    expect(rows.cleanChat).toEqual(cleanBefore.cleanChat);

    const beforeSecondRun = await readRows('chatroom_tasks', chatroomId);
    await runMigration('retireEnhancedModeTasks');
    const afterSecondRun = await readRows('chatroom_tasks', chatroomId);
    expect(afterSecondRun).toEqual(beforeSecondRun);
  });

  test('retireEnhancedModeQueuedMessages remaps the scalar mode and envelope', async () => {
    const { chatroomId } = await seedChatroom('migration-retire-enhancement-queue');

    const ids = await t.run(async (ctx) => {
      const enhanced = await ctx.db.insert('chatroom_messageQueue', {
        chatroomId,
        senderRole: 'user',
        targetRole: 'planner',
        content: 'enhanced queue row',
        type: 'message',
        queuePosition: 0,
        conversationMode: 'code:enhanced',
        taskEnvelope: enhancedEnvelope('entry'),
      });
      const clean = await ctx.db.insert('chatroom_messageQueue', {
        chatroomId,
        senderRole: 'user',
        content: 'clean queue row',
        type: 'message',
        queuePosition: 1,
        conversationMode: 'chat',
      });
      return { enhanced, clean };
    });

    const cleanBefore = await t.run(async (ctx) => ctx.db.get('chatroom_messageQueue', ids.clean));

    await runMigration('retireEnhancedModeQueuedMessages');

    const rows = await t.run(async (ctx) => ({
      enhanced: await ctx.db.get('chatroom_messageQueue', ids.enhanced),
      clean: await ctx.db.get('chatroom_messageQueue', ids.clean),
    }));

    expect(rows.enhanced?.conversationMode).toBe('code');
    expect(rows.enhanced?.taskEnvelope).toEqual({
      version: 1,
      conversationMode: 'code',
      sessionPolicy: 'continue',
      handoffWorkflow: { preset: 'team', phase: 'entry' },
    });
    expect(rows.clean).toEqual(cleanBefore);

    const beforeSecondRun = await readRows('chatroom_messageQueue', chatroomId);
    await runMigration('retireEnhancedModeQueuedMessages');
    const afterSecondRun = await readRows('chatroom_messageQueue', chatroomId);
    expect(afterSecondRun).toEqual(beforeSecondRun);
  });

  test('retireEnhancedModeScheduledPrompts remaps only the envelope', async () => {
    const { chatroomId, userId } = await seedChatroom('migration-retire-enhancement-prompts');
    const now = Date.now();

    const ids = await t.run(async (ctx) => {
      const enhanced = await ctx.db.insert('chatroom_scheduledPrompts', {
        chatroomId,
        prompt: 'enhanced scheduled prompt',
        scheduleKind: 'interval',
        intervalMinutes: 60,
        isRunnable: true,
        taskEnvelope: enhancedEnvelope('enhancement'),
        createdBy: userId,
        createdAt: now,
        updatedAt: now,
      });
      const clean = await ctx.db.insert('chatroom_scheduledPrompts', {
        chatroomId,
        prompt: 'clean scheduled prompt',
        scheduleKind: 'interval',
        intervalMinutes: 60,
        isRunnable: true,
        taskEnvelope: cleanEnvelope('delivery'),
        createdBy: userId,
        createdAt: now,
        updatedAt: now,
      });
      return { enhanced, clean };
    });

    const cleanBefore = await t.run(async (ctx) =>
      ctx.db.get('chatroom_scheduledPrompts', ids.clean)
    );

    await runMigration('retireEnhancedModeScheduledPrompts');

    const rows = await t.run(async (ctx) => ({
      enhanced: await ctx.db.get('chatroom_scheduledPrompts', ids.enhanced),
      clean: await ctx.db.get('chatroom_scheduledPrompts', ids.clean),
    }));

    expect(rows.enhanced?.taskEnvelope).toEqual(cleanEnvelope('implementation'));
    expect(rows.clean).toEqual(cleanBefore);

    const beforeSecondRun = await readRows('chatroom_scheduledPrompts', chatroomId);
    await runMigration('retireEnhancedModeScheduledPrompts');
    const afterSecondRun = await readRows('chatroom_scheduledPrompts', chatroomId);
    expect(afterSecondRun).toEqual(beforeSecondRun);
  });

  test('retireEnhancedModePreferences remaps the mode scalar', async () => {
    const { chatroomId, userId } = await seedChatroom('migration-retire-enhancement-preferences');
    const now = Date.now();

    const ids = await t.run(async (ctx) => {
      const enhanced = await ctx.db.insert('chatroom_conversationModePreferences', {
        chatroomId,
        userId,
        mode: 'code:enhanced',
        updatedAt: now,
      });
      const chat = await ctx.db.insert('chatroom_conversationModePreferences', {
        chatroomId,
        userId,
        mode: 'chat',
        updatedAt: now,
      });
      const code = await ctx.db.insert('chatroom_conversationModePreferences', {
        chatroomId,
        userId,
        mode: 'code',
        updatedAt: now,
      });
      return { enhanced, chat, code };
    });

    const cleanBefore = await t.run(async (ctx) => ({
      chat: await ctx.db.get('chatroom_conversationModePreferences', ids.chat),
      code: await ctx.db.get('chatroom_conversationModePreferences', ids.code),
    }));

    await runMigration('retireEnhancedModePreferences');

    const rows = await t.run(async (ctx) => ({
      enhanced: await ctx.db.get('chatroom_conversationModePreferences', ids.enhanced),
      chat: await ctx.db.get('chatroom_conversationModePreferences', ids.chat),
      code: await ctx.db.get('chatroom_conversationModePreferences', ids.code),
    }));

    expect(rows.enhanced?.mode).toBe('code');
    expect(rows.chat).toEqual(cleanBefore.chat);
    expect(rows.code).toEqual(cleanBefore.code);

    const beforeSecondRun = await readPreferenceRows(chatroomId);
    await runMigration('retireEnhancedModePreferences');
    const afterSecondRun = await readPreferenceRows(chatroomId);
    expect(afterSecondRun).toEqual(beforeSecondRun);
  });

  test('all four migrations leave no old values behind across tables', async () => {
    const { chatroomId, userId } = await seedChatroom('migration-retire-enhancement-all');
    const now = Date.now();

    await t.run(async (ctx) => {
      await ctx.db.insert('chatroom_tasks', {
        chatroomId,
        createdBy: 'user',
        content: 'all-mode task',
        status: 'in_progress',
        createdAt: now,
        updatedAt: now,
        queuePosition: 0,
        conversationMode: 'code:enhanced',
        taskEnvelope: enhancedEnvelope(),
      });
      await ctx.db.insert('chatroom_messageQueue', {
        chatroomId,
        senderRole: 'user',
        content: 'all-mode queue row',
        type: 'message',
        queuePosition: 0,
        conversationMode: 'code:enhanced',
        taskEnvelope: enhancedEnvelope(),
      });
      await ctx.db.insert('chatroom_scheduledPrompts', {
        chatroomId,
        prompt: 'all-mode scheduled prompt',
        scheduleKind: 'interval',
        intervalMinutes: 60,
        isRunnable: true,
        taskEnvelope: enhancedEnvelope(),
        createdBy: userId,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert('chatroom_conversationModePreferences', {
        chatroomId,
        userId,
        mode: 'code:enhanced',
        updatedAt: now,
      });
    });

    await runAllFour();

    const tasks = await readRows('chatroom_tasks', chatroomId);
    const queue = await readRows('chatroom_messageQueue', chatroomId);
    const prompts = await readRows('chatroom_scheduledPrompts', chatroomId);
    const preferences = await readPreferenceRows(chatroomId);

    for (const row of tasks) {
      expect(row.conversationMode).not.toBe('code:enhanced');
      expect(row.taskEnvelope?.conversationMode).not.toBe('code:enhanced');
      expect(row.taskEnvelope?.handoffWorkflow.preset).not.toBe('enhanced-team');
      expect(row.taskEnvelope?.handoffWorkflow.phase).not.toBe('enhancement');
    }
    for (const row of queue) {
      expect(row.conversationMode).not.toBe('code:enhanced');
      expect(row.taskEnvelope?.conversationMode).not.toBe('code:enhanced');
      expect(row.taskEnvelope?.handoffWorkflow.preset).not.toBe('enhanced-team');
      expect(row.taskEnvelope?.handoffWorkflow.phase).not.toBe('enhancement');
    }
    for (const row of prompts) {
      expect(row.taskEnvelope?.conversationMode).not.toBe('code:enhanced');
      expect(row.taskEnvelope?.handoffWorkflow.preset).not.toBe('enhanced-team');
      expect(row.taskEnvelope?.handoffWorkflow.phase).not.toBe('enhancement');
    }
    for (const row of preferences) {
      expect(row.mode).not.toBe('code:enhanced');
    }
  });
});
