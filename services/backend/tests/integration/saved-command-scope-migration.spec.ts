/**
 * Migration: backfillSavedCommandScope
 *
 * Tests inference logic and idempotent migration on scoped rows.
 * Legacy rows without scope cannot be inserted once schema requires scope;
 * production backfill runs while schema is still optional or on existing legacy data.
 */

import { describe, expect, test } from 'vitest';

import { api, internal } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { inferLegacySavedCommandScope } from '../../convex/migrations';
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
  test('inferLegacySavedCommandScope maps chatroomId → chatroom', () => {
    expect(inferLegacySavedCommandScope({ chatroomId: 'room123' })).toBe('chatroom');
  });

  test('inferLegacySavedCommandScope maps owner-only → user', () => {
    expect(inferLegacySavedCommandScope({})).toBe('user');
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
