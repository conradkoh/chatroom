/**
 * Migration: backfillSavedCommandScope
 *
 * Tests that the migration correctly:
 * 1. Sets scope='chatroom' on legacy rows with chatroomId and no scope field.
 * 2. Sets scope='user' on legacy rows with ownerId only and no scope field.
 * 3. Skips rows that already have scope set (idempotent).
 */

import { describe, expect, test } from 'vitest';

import { api, internal } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { t } from '../../test.setup';
import { createTestSession } from '../helpers/integration';

const FIXED_NOW = 1_700_000_000_000;

async function runBackfillSavedCommandScope() {
  return await t.mutation(internal.migrations.backfillSavedCommandScope, {
    cursor: null,
    batchSize: 100,
  });
}

describe('migration: backfillSavedCommandScope', () => {
  test('backfills scope=chatroom on legacy chatroom-scoped rows', async () => {
    const { sessionId } = await createTestSession('migrate-scope-chatroom');
    const chatroomId = await t.mutation(api.chatrooms.create, {
      sessionId,
      teamId: 'solo',
      teamName: 'Solo',
      teamRoles: ['user'],
      teamEntryPoint: 'user',
    });
    const userId = await t.run(async (ctx) => {
      const session = await ctx.db
        .query('sessions')
        .withIndex('by_sessionId', (q) => q.eq('sessionId', sessionId))
        .unique();
      return session!.userId;
    });

    const legacyId = await t.run(async (ctx) => {
      return await ctx.db.insert('chatroom_savedCommands', {
        chatroomId,
        createdAt: FIXED_NOW,
        createdBy: userId,
        name: 'Legacy chatroom cmd',
        prompt: 'Before scope existed',
        type: 'prompt',
        updatedAt: FIXED_NOW,
      });
    });

    await runBackfillSavedCommandScope();

    const after = await t.run(async (ctx) => ctx.db.get(legacyId));
    expect(after?.scope).toBe('chatroom');
  });

  test('backfills scope=user on legacy user-scoped rows (ownerId only)', async () => {
    const { sessionId } = await createTestSession('migrate-scope-user');
    const userId = await t.run(async (ctx) => {
      const session = await ctx.db
        .query('sessions')
        .withIndex('by_sessionId', (q) => q.eq('sessionId', sessionId))
        .unique();
      return session!.userId;
    });

    const legacyId = await t.run(async (ctx) => {
      return await ctx.db.insert('chatroom_savedCommands', {
        ownerId: userId,
        createdAt: FIXED_NOW,
        createdBy: userId,
        name: 'Legacy user cmd',
        prompt: 'User scope before field existed',
        type: 'prompt',
        updatedAt: FIXED_NOW,
      });
    });

    await runBackfillSavedCommandScope();

    const after = await t.run(async (ctx) => ctx.db.get(legacyId));
    expect(after?.scope).toBe('user');
  });

  test('skips rows that already have scope set (idempotent)', async () => {
    const { sessionId } = await createTestSession('migrate-scope-skip');
    const chatroomId = await t.mutation(api.chatrooms.create, {
      sessionId,
      teamId: 'solo',
      teamName: 'Solo',
      teamRoles: ['user'],
      teamEntryPoint: 'user',
    });
    const userId = await t.run(async (ctx) => {
      const session = await ctx.db
        .query('sessions')
        .withIndex('by_sessionId', (q) => q.eq('sessionId', sessionId))
        .unique();
      return session!.userId;
    });

    const scopedId = await t.run(async (ctx) => {
      return await ctx.db.insert('chatroom_savedCommands', {
        chatroomId,
        scope: 'user',
        ownerId: userId as Id<'users'>,
        createdAt: FIXED_NOW,
        createdBy: userId,
        name: 'Already scoped',
        prompt: 'Has scope',
        type: 'prompt',
        updatedAt: FIXED_NOW,
      });
    });

    const result = await runBackfillSavedCommandScope();
    expect(result).toBeDefined();

    const after = await t.run(async (ctx) => ctx.db.get(scopedId));
    expect(after?.scope).toBe('user');
  });
});
