/** Tests for the retained CLI/session recency projections. */

import { describe, expect, test } from 'vitest';

import { api, internal } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import {
  deleteCliSessionLastUsedAt,
  deleteSessionLastActivityAt,
  upsertCliSessionLastUsedAt,
  upsertSessionLastActivityAt,
} from '../../convex/lib/lastAtProjections';
import { t } from '../../test.setup';
import { createTestSession } from '../helpers/integration';

async function insertCliSession(lastUsedAt?: number): Promise<Id<'cliSessions'>> {
  return await t.run(async (ctx: any) => {
    const user = await ctx.db.query('users').first();
    return await ctx.db.insert('cliSessions', {
      sessionId: `cli-${Math.random().toString(36).slice(2)}`,
      userId: user!._id,
      isActive: true,
      createdAt: 1_000,
      ...(lastUsedAt === undefined ? {} : { lastUsedAt }),
    });
  });
}

async function insertWebSession(lastActivityAt?: number): Promise<Id<'sessions'>> {
  return await t.run(async (ctx: any) => {
    const user = await ctx.db.query('users').first();
    return await ctx.db.insert('sessions', {
      sessionId: `web-${Math.random().toString(36).slice(2)}`,
      userId: user!._id,
      createdAt: 1_000,
      ...(lastActivityAt === undefined ? {} : { lastActivityAt }),
    });
  });
}

function expectNoField(parent: any, field: string): void {
  expect(Object.prototype.hasOwnProperty.call(parent, field)).toBe(false);
}

describe('last-at projections: helpers', () => {
  test('CLI and web-session upserts are monotonic and unique', async () => {
    await createTestSession('lastat-helper-upsert');
    const cliSessionId = await insertCliSession();
    const sessionId = await insertWebSession();

    await t.run(async (ctx: any) => {
      await upsertCliSessionLastUsedAt(ctx, cliSessionId, 100);
      await upsertCliSessionLastUsedAt(ctx, cliSessionId, 100);
      await upsertCliSessionLastUsedAt(ctx, cliSessionId, 50);
      await upsertSessionLastActivityAt(ctx, sessionId, 200);
      await upsertSessionLastActivityAt(ctx, sessionId, 200);
      await upsertSessionLastActivityAt(ctx, sessionId, 150);
    });

    const result = await t.run(async (ctx: any) => ({
      cli: await ctx.db
        .query('chatroom_cliSessionLastUsedAt')
        .withIndex('by_cliSessionId', (q: any) => q.eq('cliSessionId', cliSessionId))
        .collect(),
      session: await ctx.db
        .query('chatroom_sessionLastActivityAt')
        .withIndex('by_sessionId', (q: any) => q.eq('sessionId', sessionId))
        .collect(),
    }));
    expect(result.cli).toHaveLength(1);
    expect(result.cli[0].lastUsedAt).toBe(100);
    expect(result.session).toHaveLength(1);
    expect(result.session[0].lastActivityAt).toBe(200);
  });

  test('deletes are idempotent and invalid timestamps are rejected', async () => {
    await createTestSession('lastat-helper-delete');
    const cliSessionId = await insertCliSession();
    const sessionId = await insertWebSession();

    await t.run(async (ctx: any) => {
      await upsertCliSessionLastUsedAt(ctx, cliSessionId, 100);
      await upsertSessionLastActivityAt(ctx, sessionId, 200);
      await deleteCliSessionLastUsedAt(ctx, cliSessionId);
      await deleteCliSessionLastUsedAt(ctx, cliSessionId);
      await deleteSessionLastActivityAt(ctx, sessionId);
      await deleteSessionLastActivityAt(ctx, sessionId);
    });

    const counts = await t.run(async (ctx: any) => ({
      cli: await ctx.db
        .query('chatroom_cliSessionLastUsedAt')
        .withIndex('by_cliSessionId', (q: any) => q.eq('cliSessionId', cliSessionId))
        .collect(),
      session: await ctx.db
        .query('chatroom_sessionLastActivityAt')
        .withIndex('by_sessionId', (q: any) => q.eq('sessionId', sessionId))
        .collect(),
    }));
    expect(counts.cli).toHaveLength(0);
    expect(counts.session).toHaveLength(0);

    await expect(
      t.run(async (ctx: any) => upsertCliSessionLastUsedAt(ctx, cliSessionId, Number.NaN))
    ).rejects.toThrow();
    await expect(
      t.run(async (ctx: any) => upsertSessionLastActivityAt(ctx, sessionId, -1))
    ).rejects.toThrow();
  });
});

describe('last-at projections: backfills', () => {
  test('backfills retained CLI/session values without regressing newer rows', async () => {
    await createTestSession('lastat-backfill');
    const cliSessionId = await insertCliSession(1_100);
    const activeSessionId = await insertWebSession(1_300);
    const idleSessionId = await insertWebSession();
    const newerCliSessionId = await insertCliSession(1_100);
    const newerSessionId = await insertWebSession(1_300);

    await t.run(async (ctx: any) => {
      await upsertCliSessionLastUsedAt(ctx, newerCliSessionId, 9_100);
      await upsertSessionLastActivityAt(ctx, newerSessionId, 9_300);
    });

    const runBackfills = async () => {
      await t.mutation(internal.migrations.backfillCliSessionLastUsedAt, {
        cursor: null,
        batchSize: 100,
      });
      await t.mutation(internal.migrations.backfillSessionLastActivityAt, {
        cursor: null,
        batchSize: 100,
      });
    };
    await runBackfills();
    await runBackfills();

    const result = await t.run(async (ctx: any) => {
      const by = async (table: string, index: string, key: string, value: any) =>
        ctx.db
          .query(table)
          .withIndex(index, (q: any) => q.eq(key, value))
          .collect();
      return {
        cli: await by(
          'chatroom_cliSessionLastUsedAt',
          'by_cliSessionId',
          'cliSessionId',
          cliSessionId
        ),
        active: await by(
          'chatroom_sessionLastActivityAt',
          'by_sessionId',
          'sessionId',
          activeSessionId
        ),
        idle: await by(
          'chatroom_sessionLastActivityAt',
          'by_sessionId',
          'sessionId',
          idleSessionId
        ),
        newerCli: await by(
          'chatroom_cliSessionLastUsedAt',
          'by_cliSessionId',
          'cliSessionId',
          newerCliSessionId
        ),
        newerActive: await by(
          'chatroom_sessionLastActivityAt',
          'by_sessionId',
          'sessionId',
          newerSessionId
        ),
      };
    });
    expect(result.cli[0].lastUsedAt).toBe(1_100);
    expect(result.active[0].lastActivityAt).toBe(1_300);
    expect(result.idle).toHaveLength(0);
    expect(result.newerCli[0].lastUsedAt).toBe(9_100);
    expect(result.newerActive[0].lastActivityAt).toBe(9_300);
  });
});

describe('last-at projections: writers and readers', () => {
  test('session and CLI writers populate projections and omit legacy fields', async () => {
    const suffix = Math.random().toString(36).slice(2);
    const { sessionId } = await createTestSession(`lastat-writers-${suffix}`);

    await t.mutation(api.sessions.updateSessionActivity, { sessionId });
    const deviceAt = Date.now() + 30_000;
    const sessionDocId = await t.run(async (ctx: any) => {
      const row = await ctx.db
        .query('sessions')
        .withIndex('by_sessionId', (q: any) => q.eq('sessionId', sessionId))
        .unique();
      return row!._id;
    });
    await t.mutation(internal.sessions.updateSessionDeviceInfo, {
      sessionId: sessionDocId,
      deviceInfo: { userAgent: `ua-${suffix}` },
      lastActivityAt: deviceAt,
    });

    const { requestId } = await t.mutation(api.cliAuth.createAuthRequest, {});
    await t.mutation(api.cliAuth.approveAuthRequest, { requestId, sessionId });
    const approved = await t.query(api.cliAuth.getAuthRequestStatus, { requestId });
    if (approved.status !== 'approved') throw new Error('expected approved auth request');
    await t.mutation(api.cliAuth.touchSession, { sessionId: approved.sessionId as any });

    const result = await t.run(async (ctx: any) => {
      const web = await ctx.db.get(sessionDocId);
      const webProjection = await ctx.db
        .query('chatroom_sessionLastActivityAt')
        .withIndex('by_sessionId', (q: any) => q.eq('sessionId', sessionDocId))
        .unique();
      const cli = await ctx.db
        .query('cliSessions')
        .withIndex('by_sessionId', (q: any) => q.eq('sessionId', approved.sessionId))
        .unique();
      const cliProjection = await ctx.db
        .query('chatroom_cliSessionLastUsedAt')
        .withIndex('by_cliSessionId', (q: any) => q.eq('cliSessionId', cli!._id))
        .unique();
      return { web, webProjection, cli, cliProjection };
    });
    expectNoField(result.web, 'lastActivityAt');
    expect(result.webProjection?.lastActivityAt).toBe(deviceAt);
    expectNoField(result.cli, 'lastUsedAt');
    expect(Number.isFinite(result.cliProjection?.lastUsedAt)).toBe(true);

    const sessions = await t.query(api.sessions.listMySessions, { sessionId });
    expect((sessions.sessions ?? []).find((row: any) => row.isCurrent)?.lastActivityAt).toBe(
      deviceAt
    );
    const cliSessions = await t.query(api.cliAuth.listUserSessions, { sessionId });
    expect(
      typeof cliSessions.find((row: any) => row.sessionId === approved.sessionId)?.lastUsedAt
    ).toBe('number');
  });

  test('logout removes the web-session projection', async () => {
    const { sessionId } = await createTestSession('lastat-logout');
    await t.mutation(api.sessions.updateSessionActivity, { sessionId });
    const docId = await t.run(async (ctx: any) => {
      const row = await ctx.db
        .query('sessions')
        .withIndex('by_sessionId', (q: any) => q.eq('sessionId', sessionId))
        .unique();
      return row!._id;
    });
    await t.mutation(api.auth.logout, { sessionId });
    const projection = await t.run(async (ctx: any) =>
      ctx.db
        .query('chatroom_sessionLastActivityAt')
        .withIndex('by_sessionId', (q: any) => q.eq('sessionId', docId))
        .unique()
    );
    expect(projection).toBeNull();
  });
});
