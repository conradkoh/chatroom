/**
 * Slice 1: last-at timestamp projections.
 *
 * Covers the additive projection tables, canonical upsert/delete helpers,
 * and idempotent backfills. Legacy fields are not modified here.
 */

import { describe, expect, test } from 'vitest';

import { api, internal } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import {
  deleteCliSessionLastUsedAt,
  deleteMachineLastSeenAt,
  deleteSessionLastActivityAt,
  upsertCliSessionLastUsedAt,
  upsertMachineLastSeenAt,
  upsertSessionLastActivityAt,
} from '../../convex/lib/lastAtProjections';
import { t } from '../../test.setup';
import { createTestSession } from '../helpers/integration';

async function insertCliSession(lastUsedAt: number): Promise<Id<'cliSessions'>> {
  return await t.run(async (ctx: any) => {
    const user = await ctx.db.query('users').first();
    return await ctx.db.insert('cliSessions', {
      sessionId: `cli-${Math.random().toString(36).slice(2)}`,
      userId: user!._id,
      isActive: true,
      createdAt: 1_000,
      lastUsedAt,
    });
  });
}

async function insertWebSession(lastActivityAt?: number): Promise<Id<'sessions'>> {
  return await t.run(async (ctx: any) => {
    const sessionId = `web-${Math.random().toString(36).slice(2)}`;
    return await ctx.db.insert('sessions', {
      sessionId,
      createdAt: 1_000,
      ...(lastActivityAt === undefined ? {} : { lastActivityAt }),
    });
  });
}

async function insertMachine(machineId: string, lastSeenAt: number): Promise<void> {
  await t.run(async (ctx: any) => {
    const user = await ctx.db.query('users').first();
    await ctx.db.insert('chatroom_machines', {
      machineId,
      userId: user!._id,
      hostname: 'test-host',
      os: 'darwin',
      availableHarnesses: ['opencode'],
      registeredAt: 1_000,
      lastSeenAt,
      daemonConnected: false,
    });
  });
}

describe('last-at projections: helpers', () => {
  test('cli upsert inserts once, advances on newer, ignores equal/older', async () => {
    await createTestSession('lastat-cli-upsert');
    const cliSessionId = await insertCliSession(100);

    await t.run(async (ctx: any) => {
      await upsertCliSessionLastUsedAt(ctx, cliSessionId, 100);
    });
    await t.run(async (ctx: any) => {
      await upsertCliSessionLastUsedAt(ctx, cliSessionId, 100);
    });
    let rows = await t.run(async (ctx: any) =>
      ctx.db
        .query('chatroom_cliSessionLastUsedAt')
        .withIndex('by_cliSessionId', (q: any) => q.eq('cliSessionId', cliSessionId))
        .collect()
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].lastUsedAt).toBe(100);

    // Newer advances
    await t.run(async (ctx: any) => {
      await upsertCliSessionLastUsedAt(ctx, cliSessionId, 200);
    });
    rows = await t.run(async (ctx: any) =>
      ctx.db
        .query('chatroom_cliSessionLastUsedAt')
        .withIndex('by_cliSessionId', (q: any) => q.eq('cliSessionId', cliSessionId))
        .collect()
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].lastUsedAt).toBe(200);

    // Equal and older are no-ops
    await t.run(async (ctx: any) => {
      await upsertCliSessionLastUsedAt(ctx, cliSessionId, 200);
      await upsertCliSessionLastUsedAt(ctx, cliSessionId, 150);
    });
    rows = await t.run(async (ctx: any) =>
      ctx.db
        .query('chatroom_cliSessionLastUsedAt')
        .withIndex('by_cliSessionId', (q: any) => q.eq('cliSessionId', cliSessionId))
        .collect()
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].lastUsedAt).toBe(200);
  });

  test('session upsert inserts once, advances on newer, ignores equal/older', async () => {
    await createTestSession('lastat-session-upsert');
    const sessionId = await insertWebSession(500);

    await t.run(async (ctx: any) => {
      await upsertSessionLastActivityAt(ctx, sessionId, 500);
      await upsertSessionLastActivityAt(ctx, sessionId, 500);
    });
    let rows = await t.run(async (ctx: any) =>
      ctx.db
        .query('chatroom_sessionLastActivityAt')
        .withIndex('by_sessionId', (q: any) => q.eq('sessionId', sessionId))
        .collect()
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].lastActivityAt).toBe(500);

    await t.run(async (ctx: any) => {
      await upsertSessionLastActivityAt(ctx, sessionId, 700);
    });
    rows = await t.run(async (ctx: any) =>
      ctx.db
        .query('chatroom_sessionLastActivityAt')
        .withIndex('by_sessionId', (q: any) => q.eq('sessionId', sessionId))
        .collect()
    );
    expect(rows[0].lastActivityAt).toBe(700);

    await t.run(async (ctx: any) => {
      await upsertSessionLastActivityAt(ctx, sessionId, 700);
      await upsertSessionLastActivityAt(ctx, sessionId, 600);
    });
    rows = await t.run(async (ctx: any) =>
      ctx.db
        .query('chatroom_sessionLastActivityAt')
        .withIndex('by_sessionId', (q: any) => q.eq('sessionId', sessionId))
        .collect()
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].lastActivityAt).toBe(700);
  });

  test('machine upsert inserts once, advances on newer, ignores equal/older', async () => {
    await createTestSession('lastat-machine-upsert');
    const machineId = `lastat-machine-${Math.random().toString(36).slice(2)}`;

    await t.run(async (ctx: any) => {
      await upsertMachineLastSeenAt(ctx, machineId, 300);
      await upsertMachineLastSeenAt(ctx, machineId, 300);
    });
    let rows = await t.run(async (ctx: any) =>
      ctx.db
        .query('chatroom_machineLastSeenAt')
        .withIndex('by_machineId', (q: any) => q.eq('machineId', machineId))
        .collect()
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].lastSeenAt).toBe(300);

    await t.run(async (ctx: any) => {
      await upsertMachineLastSeenAt(ctx, machineId, 400);
    });
    rows = await t.run(async (ctx: any) =>
      ctx.db
        .query('chatroom_machineLastSeenAt')
        .withIndex('by_machineId', (q: any) => q.eq('machineId', machineId))
        .collect()
    );
    expect(rows[0].lastSeenAt).toBe(400);

    await t.run(async (ctx: any) => {
      await upsertMachineLastSeenAt(ctx, machineId, 400);
      await upsertMachineLastSeenAt(ctx, machineId, 350);
    });
    rows = await t.run(async (ctx: any) =>
      ctx.db
        .query('chatroom_machineLastSeenAt')
        .withIndex('by_machineId', (q: any) => q.eq('machineId', machineId))
        .collect()
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].lastSeenAt).toBe(400);
  });

  test('deletes are idempotent', async () => {
    await createTestSession('lastat-deletes');
    const cliSessionId = await insertCliSession(100);
    const sessionId = await insertWebSession(200);
    const machineId = `lastat-del-${Math.random().toString(36).slice(2)}`;

    await t.run(async (ctx: any) => {
      await upsertCliSessionLastUsedAt(ctx, cliSessionId, 100);
      await upsertSessionLastActivityAt(ctx, sessionId, 200);
      await upsertMachineLastSeenAt(ctx, machineId, 300);
    });

    await t.run(async (ctx: any) => {
      await deleteCliSessionLastUsedAt(ctx, cliSessionId);
      await deleteSessionLastActivityAt(ctx, sessionId);
      await deleteMachineLastSeenAt(ctx, machineId);
    });
    // Second delete must not throw and must leave tables empty for the mapping.
    await t.run(async (ctx: any) => {
      await deleteCliSessionLastUsedAt(ctx, cliSessionId);
      await deleteSessionLastActivityAt(ctx, sessionId);
      await deleteMachineLastSeenAt(ctx, machineId);
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
      machine: await ctx.db
        .query('chatroom_machineLastSeenAt')
        .withIndex('by_machineId', (q: any) => q.eq('machineId', machineId))
        .collect(),
    }));
    expect(counts.cli).toHaveLength(0);
    expect(counts.session).toHaveLength(0);
    expect(counts.machine).toHaveLength(0);
  });

  test('helpers reject invalid timestamps', async () => {
    await createTestSession('lastat-invalid');
    const cliSessionId = await insertCliSession(100);
    const sessionId = await insertWebSession(100);
    const machineId = `lastat-invalid-${Math.random().toString(36).slice(2)}`;

    await expect(
      t.run(async (ctx: any) => {
        await upsertCliSessionLastUsedAt(ctx, cliSessionId, NaN);
      })
    ).rejects.toThrow();
    await expect(
      t.run(async (ctx: any) => {
        await upsertSessionLastActivityAt(ctx, sessionId, -1);
      })
    ).rejects.toThrow();
    await expect(
      t.run(async (ctx: any) => {
        await upsertMachineLastSeenAt(ctx, machineId, Number.POSITIVE_INFINITY);
      })
    ).rejects.toThrow();
  });

  test('timestamp indexes return rows in ascending order', async () => {
    await createTestSession('lastat-ordering');
    const suffix = Math.random().toString(36).slice(2);
    const machineIds = [`order-a-${suffix}`, `order-b-${suffix}`, `order-c-${suffix}`];
    await t.run(async (ctx: any) => {
      await upsertMachineLastSeenAt(ctx, machineIds[0], 300);
      await upsertMachineLastSeenAt(ctx, machineIds[1], 100);
      await upsertMachineLastSeenAt(ctx, machineIds[2], 200);
    });
    const ordered = await t.run(async (ctx: any) =>
      ctx.db.query('chatroom_machineLastSeenAt').withIndex('by_lastSeenAt').collect()
    );
    const relevant = ordered.filter((row: any) => machineIds.includes(row.machineId));
    expect(relevant.map((row: any) => row.lastSeenAt)).toEqual([100, 200, 300]);
  });
});

describe('last-at projections: backfills', () => {
  test('backfills populate projections, preserve newer values, skip missing activity', async () => {
    await createTestSession('lastat-backfill');
    const suffix = Math.random().toString(36).slice(2);

    // CLI source row with a pre-existing newer projection row.
    const cliSessionId = await insertCliSession(1000);
    await t.run(async (ctx: any) => {
      await upsertCliSessionLastUsedAt(ctx, cliSessionId, 5000);
    });

    // Web session with activity + session without activity.
    const activeSessionId = await insertWebSession(2000);
    const idleSessionId = await insertWebSession(undefined);
    // Pre-existing newer projection for the active session.
    await t.run(async (ctx: any) => {
      await upsertSessionLastActivityAt(ctx, activeSessionId, 9000);
    });

    // Machine source row with a pre-existing newer projection row.
    const machineId = `backfill-machine-${suffix}`;
    await insertMachine(machineId, 3000);
    await t.run(async (ctx: any) => {
      await upsertMachineLastSeenAt(ctx, machineId, 8000);
    });
    // Machine source row with no pre-existing projection.
    const freshMachineId = `backfill-fresh-${suffix}`;
    await insertMachine(freshMachineId, 4000);

    await t.mutation(internal.migrations.backfillCliSessionLastUsedAt, {
      cursor: null,
      batchSize: 100,
    });
    await t.mutation(internal.migrations.backfillSessionLastActivityAt, {
      cursor: null,
      batchSize: 100,
    });
    await t.mutation(internal.migrations.backfillMachineLastSeenAt, {
      cursor: null,
      batchSize: 100,
    });

    // Rerun to prove idempotency.
    await t.mutation(internal.migrations.backfillCliSessionLastUsedAt, {
      cursor: null,
      batchSize: 100,
    });
    await t.mutation(internal.migrations.backfillSessionLastActivityAt, {
      cursor: null,
      batchSize: 100,
    });
    await t.mutation(internal.migrations.backfillMachineLastSeenAt, {
      cursor: null,
      batchSize: 100,
    });

    const result = await t.run(async (ctx: any) => ({
      cli: await ctx.db
        .query('chatroom_cliSessionLastUsedAt')
        .withIndex('by_cliSessionId', (q: any) => q.eq('cliSessionId', cliSessionId))
        .first(),
      active: await ctx.db
        .query('chatroom_sessionLastActivityAt')
        .withIndex('by_sessionId', (q: any) => q.eq('sessionId', activeSessionId))
        .first(),
      idle: await ctx.db
        .query('chatroom_sessionLastActivityAt')
        .withIndex('by_sessionId', (q: any) => q.eq('sessionId', idleSessionId))
        .first(),
      machine: await ctx.db
        .query('chatroom_machineLastSeenAt')
        .withIndex('by_machineId', (q: any) => q.eq('machineId', machineId))
        .first(),
      fresh: await ctx.db
        .query('chatroom_machineLastSeenAt')
        .withIndex('by_machineId', (q: any) => q.eq('machineId', freshMachineId))
        .first(),
      cliSource: await ctx.db.get(cliSessionId),
      machineSource: await ctx.db
        .query('chatroom_machines')
        .withIndex('by_machineId', (q: any) => q.eq('machineId', machineId))
        .first(),
    }));

    // Newer pre-existing values preserved (not regressed to older source).
    expect(result.cli?.lastUsedAt).toBe(5000);
    expect(result.active?.lastActivityAt).toBe(9000);
    expect(result.machine?.lastSeenAt).toBe(8000);
    // Fresh machine backfilled from its source value.
    expect(result.fresh?.lastSeenAt).toBe(4000);
    // Session without lastActivityAt produces no projection row.
    expect(result.idle).toBeNull();
    // Legacy fields untouched.
    expect(result.cliSource?.lastUsedAt).toBe(1000);
    expect(result.machineSource?.lastSeenAt).toBe(3000);
  });
});

describe('last-at projections: session dual writes', () => {
  test('cliAuth.approveAuthRequest dual-writes cli projection', async () => {
    const suffix = Math.random().toString(36).slice(2);
    const { sessionId } = await createTestSession(`lastat-approve-${suffix}`);

    const { requestId } = await t.mutation(api.cliAuth.createAuthRequest, {
      deviceName: `device-${suffix}`,
    });
    const approved = await t.mutation(api.cliAuth.approveAuthRequest, {
      requestId,
      sessionId,
    });
    expect(approved).toEqual({ success: true });

    const status = await t.query(api.cliAuth.getAuthRequestStatus, { requestId });
    if (status.status !== 'approved') throw new Error('expected approved auth request');
    const publicCliSessionId = status.sessionId;

    const result = await t.run(async (ctx: any) => {
      const parent = await ctx.db
        .query('cliSessions')
        .withIndex('by_sessionId', (q: any) => q.eq('sessionId', publicCliSessionId))
        .unique();
      if (!parent) throw new Error('cliSessions parent not found');
      const projection = await ctx.db
        .query('chatroom_cliSessionLastUsedAt')
        .withIndex('by_cliSessionId', (q: any) => q.eq('cliSessionId', parent._id))
        .unique();
      return { parent, projection };
    });
    expect(result.parent.lastUsedAt).toEqual(expect.any(Number));
    expect(result.projection).not.toBeNull();
    expect(result.projection.lastUsedAt).toBe(result.parent.lastUsedAt);
  });

  test('cliAuth.touchSession advances parent and projection together', async () => {
    const suffix = Math.random().toString(36).slice(2);
    const { sessionId } = await createTestSession(`lastat-touch-${suffix}`);

    const { requestId } = await t.mutation(api.cliAuth.createAuthRequest, {});
    const approved = await t.mutation(api.cliAuth.approveAuthRequest, {
      requestId,
      sessionId,
    });
    expect(approved).toEqual({ success: true });
    const status = await t.query(api.cliAuth.getAuthRequestStatus, { requestId });
    if (status.status !== 'approved') throw new Error('expected approved auth request');

    const touched = await t.mutation(api.cliAuth.touchSession, {
      sessionId: status.sessionId as any,
    });
    expect(touched).toBe(true);

    const result = await t.run(async (ctx: any) => {
      const parent = await ctx.db
        .query('cliSessions')
        .withIndex('by_sessionId', (q: any) => q.eq('sessionId', status.sessionId))
        .unique();
      if (!parent) throw new Error('cliSessions parent not found');
      const projection = await ctx.db
        .query('chatroom_cliSessionLastUsedAt')
        .withIndex('by_cliSessionId', (q: any) => q.eq('cliSessionId', parent._id))
        .unique();
      return { parent, projection };
    });
    expect(result.projection).not.toBeNull();
    expect(result.projection.lastUsedAt).toBe(result.parent.lastUsedAt);
  });

  test('sessions.updateSessionActivity dual-writes session projection', async () => {
    const suffix = Math.random().toString(36).slice(2);
    const { sessionId } = await createTestSession(`lastat-activity-${suffix}`);

    const updated = await t.mutation(api.sessions.updateSessionActivity, { sessionId });
    expect(updated).toEqual({ success: true });

    const result = await t.run(async (ctx: any) => {
      const parent = await ctx.db
        .query('sessions')
        .withIndex('by_sessionId', (q: any) => q.eq('sessionId', sessionId))
        .unique();
      if (!parent) throw new Error('sessions parent not found');
      const projection = await ctx.db
        .query('chatroom_sessionLastActivityAt')
        .withIndex('by_sessionId', (q: any) => q.eq('sessionId', parent._id))
        .unique();
      return { parent, projection };
    });
    expect(Number.isFinite(result.parent.lastActivityAt)).toBe(true);
    expect(result.projection).not.toBeNull();
    expect(result.projection.lastActivityAt).toBe(result.parent.lastActivityAt);
  });

  test('sessions.updateSessionDeviceInfo dual-writes session projection', async () => {
    const suffix = Math.random().toString(36).slice(2);
    const { sessionId } = await createTestSession(`lastat-device-${suffix}`);

    const parentDocId = await t.run(async (ctx: any) => {
      const parent = await ctx.db
        .query('sessions')
        .withIndex('by_sessionId', (q: any) => q.eq('sessionId', sessionId))
        .unique();
      if (!parent) throw new Error('sessions parent not found');
      return parent._id;
    });

    const lastActivityAt = Date.now() + 60_000;
    await t.mutation(internal.sessions.updateSessionDeviceInfo, {
      sessionId: parentDocId,
      deviceInfo: { userAgent: `ua-${suffix}` },
      lastActivityAt,
    });

    const result = await t.run(async (ctx: any) => {
      const parent = await ctx.db.get(parentDocId);
      const projection = await ctx.db
        .query('chatroom_sessionLastActivityAt')
        .withIndex('by_sessionId', (q: any) => q.eq('sessionId', parentDocId))
        .unique();
      return { parent, projection };
    });
    expect(result.parent.lastActivityAt).toBe(lastActivityAt);
    expect(result.projection).not.toBeNull();
    expect(result.projection.lastActivityAt).toBe(lastActivityAt);
  });

  test('auth.logout removes the web session projection', async () => {
    const suffix = Math.random().toString(36).slice(2);
    const { sessionId } = await createTestSession(`lastat-logout-${suffix}`);
    await t.mutation(api.sessions.updateSessionActivity, { sessionId });

    const parentDocId: Id<'sessions'> = await t.run(async (ctx: any) => {
      const parent = await ctx.db
        .query('sessions')
        .withIndex('by_sessionId', (q: any) => q.eq('sessionId', sessionId))
        .unique();
      if (!parent) throw new Error('sessions parent not found');
      return parent._id;
    });
    const before = await t.run(async (ctx: any) =>
      ctx.db
        .query('chatroom_sessionLastActivityAt')
        .withIndex('by_sessionId', (q: any) => q.eq('sessionId', parentDocId))
        .unique()
    );
    expect(before).not.toBeNull();

    await t.mutation(api.auth.logout, { sessionId });

    const after = await t.run(async (ctx: any) => ({
      parent: await ctx.db.get(parentDocId),
      projection: await ctx.db
        .query('chatroom_sessionLastActivityAt')
        .withIndex('by_sessionId', (q: any) => q.eq('sessionId', parentDocId))
        .unique(),
    }));
    expect(after.parent).toBeNull();
    expect(after.projection).toBeNull();
  });

  test('sessions.revokeSession removes target projection, retains current', async () => {
    const suffix = Math.random().toString(36).slice(2);
    const { sessionId } = await createTestSession(`lastat-revoke-${suffix}`);
    await t.mutation(api.sessions.updateSessionActivity, { sessionId });

    const ids = await t.run(async (ctx: any) => {
      const current = await ctx.db
        .query('sessions')
        .withIndex('by_sessionId', (q: any) => q.eq('sessionId', sessionId))
        .unique();
      if (!current) throw new Error('current session not found');
      const otherPublicId = `lastat-revoke-other-${suffix}`;
      const otherDocId = await ctx.db.insert('sessions', {
        sessionId: otherPublicId,
        userId: current.userId,
        createdAt: 1_000,
        lastActivityAt: 2_000,
      });
      await upsertSessionLastActivityAt(ctx, otherDocId, 2_000);
      await upsertSessionLastActivityAt(ctx, current._id, current.lastActivityAt ?? Date.now());
      return { currentDocId: current._id, otherDocId };
    });

    const revoked = await t.mutation(api.sessions.revokeSession, {
      sessionIdToRevoke: ids.otherDocId,
      sessionId,
    });
    expect(revoked).toEqual({ success: true });

    const result = await t.run(async (ctx: any) => ({
      targetParent: await ctx.db.get(ids.otherDocId),
      targetProjection: await ctx.db
        .query('chatroom_sessionLastActivityAt')
        .withIndex('by_sessionId', (q: any) => q.eq('sessionId', ids.otherDocId))
        .unique(),
      currentProjection: await ctx.db
        .query('chatroom_sessionLastActivityAt')
        .withIndex('by_sessionId', (q: any) => q.eq('sessionId', ids.currentDocId))
        .unique(),
    }));
    expect(result.targetParent).toBeNull();
    expect(result.targetProjection).toBeNull();
    expect(result.currentProjection).not.toBeNull();
  });

  test('sessions.revokeAllOtherSessions removes all revoked projections', async () => {
    const suffix = Math.random().toString(36).slice(2);
    const { sessionId } = await createTestSession(`lastat-revoke-all-${suffix}`);
    await t.mutation(api.sessions.updateSessionActivity, { sessionId });

    const ids = await t.run(async (ctx: any) => {
      const current = await ctx.db
        .query('sessions')
        .withIndex('by_sessionId', (q: any) => q.eq('sessionId', sessionId))
        .unique();
      if (!current) throw new Error('current session not found');
      const others: Id<'sessions'>[] = [];
      for (let i = 0; i < 2; i++) {
        const docId = await ctx.db.insert('sessions', {
          sessionId: `lastat-revoke-all-other-${suffix}-${i}`,
          userId: current.userId,
          createdAt: 1_000,
          lastActivityAt: 3_000 + i,
        });
        await upsertSessionLastActivityAt(ctx, docId, 3_000 + i);
        others.push(docId);
      }
      await upsertSessionLastActivityAt(ctx, current._id, current.lastActivityAt ?? Date.now());
      return { currentDocId: current._id, others };
    });

    const revoked = await t.mutation(api.sessions.revokeAllOtherSessions, { sessionId });
    expect(revoked.success).toBe(true);
    expect(revoked.revokedCount).toBe(2);

    const result = await t.run(async (ctx: any) => {
      const projections = [];
      for (const docId of ids.others) {
        projections.push(
          await ctx.db
            .query('chatroom_sessionLastActivityAt')
            .withIndex('by_sessionId', (q: any) => q.eq('sessionId', docId))
            .unique()
        );
      }
      const currentProjection = await ctx.db
        .query('chatroom_sessionLastActivityAt')
        .withIndex('by_sessionId', (q: any) => q.eq('sessionId', ids.currentDocId))
        .unique();
      return { projections, currentProjection };
    });
    expect(result.projections).toEqual([null, null]);
    expect(result.currentProjection).not.toBeNull();
  });
});
