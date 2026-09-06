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
import { TEST_MODEL_OPENCODE } from '../helpers/test-models';

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

describe('last-at projections: machine dual writes', () => {
  async function readMachineAndProjection(machineId: string) {
    return await t.run(async (ctx: any) => {
      const machine = await ctx.db
        .query('chatroom_machines')
        .withIndex('by_machineId', (q: any) => q.eq('machineId', machineId))
        .unique();
      if (!machine) throw new Error('chatroom_machines parent not found');
      const projections = await ctx.db
        .query('chatroom_machineLastSeenAt')
        .withIndex('by_machineId', (q: any) => q.eq('machineId', machineId))
        .collect();
      const liveness = await ctx.db
        .query('chatroom_machineLiveness')
        .withIndex('by_machineId', (q: any) => q.eq('machineId', machineId))
        .unique();
      return { machine, projections, liveness };
    });
  }

  test('machines.register new machine dual-writes machine projection', async () => {
    const suffix = Math.random().toString(36).slice(2);
    const { sessionId } = await createTestSession(`lastat-machine-register-${suffix}`);
    const machineId = `lastat-register-${suffix}`;

    const result = await t.mutation(api.machines.register, {
      sessionId,
      machineId,
      hostname: 'test-host',
      os: 'darwin',
      availableHarnesses: ['opencode'],
      availableModels: { opencode: [TEST_MODEL_OPENCODE] },
    });
    expect(result).toEqual({ machineId, isNew: true });

    const { machine, projections } = await readMachineAndProjection(machineId);
    expect(Number.isFinite(machine.lastSeenAt)).toBe(true);
    expect(projections).toHaveLength(1);
    expect(projections[0].lastSeenAt).toBe(machine.lastSeenAt);
  });

  test('machines.register existing and refreshCapabilities keep projection in parity', async () => {
    const suffix = Math.random().toString(36).slice(2);
    const { sessionId } = await createTestSession(`lastat-machine-update-${suffix}`);
    const machineId = `lastat-update-${suffix}`;

    await t.mutation(api.machines.register, {
      sessionId,
      machineId,
      hostname: 'test-host',
      os: 'darwin',
      availableHarnesses: ['opencode'],
      availableModels: { opencode: [TEST_MODEL_OPENCODE] },
    });

    // Re-register (existing-machine path) with a changed hostname.
    const second = await t.mutation(api.machines.register, {
      sessionId,
      machineId,
      hostname: 'test-host-renamed',
      os: 'darwin',
      availableHarnesses: ['opencode'],
      availableModels: { opencode: [TEST_MODEL_OPENCODE] },
    });
    expect(second).toEqual({ machineId, isNew: false });

    let state = await readMachineAndProjection(machineId);
    expect(state.projections).toHaveLength(1);
    expect(state.projections[0].lastSeenAt).toBe(state.machine.lastSeenAt);

    // Runtime capability refresh path.
    await t.mutation(api.machines.refreshCapabilities, {
      sessionId,
      machineId,
      availableHarnesses: ['opencode'],
      availableModels: { opencode: [TEST_MODEL_OPENCODE] },
    });

    state = await readMachineAndProjection(machineId);
    expect(state.projections).toHaveLength(1);
    expect(state.projections[0].lastSeenAt).toBe(state.machine.lastSeenAt);
  });

  test('machines.updateDaemonStatus dual-writes projection, liveness stays separate', async () => {
    const suffix = Math.random().toString(36).slice(2);
    const { sessionId } = await createTestSession(`lastat-machine-status-${suffix}`);
    const machineId = `lastat-status-${suffix}`;

    await t.mutation(api.machines.register, {
      sessionId,
      machineId,
      hostname: 'test-host',
      os: 'darwin',
      availableHarnesses: ['opencode'],
      availableModels: { opencode: [TEST_MODEL_OPENCODE] },
    });
    await t.mutation(api.machines.updateDaemonStatus, {
      sessionId,
      machineId,
      connected: true,
    });

    const { machine, projections, liveness } = await readMachineAndProjection(machineId);
    expect(machine.daemonConnected).toBe(true);
    expect(projections).toHaveLength(1);
    expect(projections[0].lastSeenAt).toBe(machine.lastSeenAt);
    // Liveness is a separate authoritative table, not the cleanup projection.
    expect(liveness).not.toBeNull();
    expect(Number.isFinite(liveness.lastSeenAt)).toBe(true);
  });

  test('machines.daemonHeartbeat does not touch the dedicated cleanup projection', async () => {
    const suffix = Math.random().toString(36).slice(2);
    const { sessionId } = await createTestSession(`lastat-machine-hb-${suffix}`);
    const machineId = `lastat-hb-${suffix}`;

    await t.mutation(api.machines.register, {
      sessionId,
      machineId,
      hostname: 'test-host',
      os: 'darwin',
      availableHarnesses: ['opencode'],
      availableModels: { opencode: [TEST_MODEL_OPENCODE] },
    });
    // Disconnect so the heartbeat performs a real liveness write (not a noop).
    await t.mutation(api.machines.updateDaemonStatus, {
      sessionId,
      machineId,
      connected: false,
    });

    const before = await readMachineAndProjection(machineId);
    expect(before.projections).toHaveLength(1);
    expect(before.liveness?.daemonConnected).toBe(false);

    const heartbeat = await t.mutation(api.machines.daemonHeartbeat, {
      sessionId,
      machineId,
    });
    expect(heartbeat.success).toBe(true);

    const after = await readMachineAndProjection(machineId);
    // Heartbeat flipped liveness connectivity but left the legacy field
    // and the dedicated cleanup projection untouched.
    expect(after.liveness?.daemonConnected).toBe(true);
    expect(after.machine.lastSeenAt).toBe(before.machine.lastSeenAt);
    expect(after.projections).toHaveLength(1);
    expect(after.projections[0].lastSeenAt).toBe(before.projections[0].lastSeenAt);
  });

  test('chatroomCleanup.cleanupMachines deletes parent and projection', async () => {
    const suffix = Math.random().toString(36).slice(2);
    const { sessionId } = await createTestSession(`lastat-machine-cleanup-${suffix}`);
    const machineId = `lastat-cleanup-${suffix}`;
    const staleLastSeenAt = Date.now() - 91 * 24 * 60 * 60 * 1000;

    await t.run(async (ctx: any) => {
      const session = await ctx.db
        .query('sessions')
        .withIndex('by_sessionId', (q: any) => q.eq('sessionId', sessionId))
        .unique();
      if (!session) throw new Error('test session not found');
      await ctx.db.insert('chatroom_machines', {
        machineId,
        userId: session.userId,
        hostname: 'test-host',
        os: 'darwin',
        availableHarnesses: ['opencode'],
        registeredAt: staleLastSeenAt,
        lastSeenAt: staleLastSeenAt,
        daemonConnected: false,
      });
      await upsertMachineLastSeenAt(ctx, machineId, staleLastSeenAt);
    });

    const before = await readMachineAndProjection(machineId);
    expect(before.machine.lastSeenAt).toBe(staleLastSeenAt);
    expect(before.projections).toHaveLength(1);

    await t.mutation(internal.chatroomCleanup.cleanupMachines, {});

    const after = await t.run(async (ctx: any) => ({
      machine: await ctx.db
        .query('chatroom_machines')
        .withIndex('by_machineId', (q: any) => q.eq('machineId', machineId))
        .unique(),
      projection: await ctx.db
        .query('chatroom_machineLastSeenAt')
        .withIndex('by_machineId', (q: any) => q.eq('machineId', machineId))
        .unique(),
    }));
    expect(after.machine).toBeNull();
    expect(after.projection).toBeNull();
  });
});

describe('last-at projections: projection-backed readers and cleanup', () => {
  test('sessions.listMySessions prefers projection, falls back to legacy', async () => {
    const suffix = Math.random().toString(36).slice(2);
    const { sessionId } = await createTestSession(`lastat-reader-session-${suffix}`);

    const ids = await t.run(async (ctx: any) => {
      const current = await ctx.db
        .query('sessions')
        .withIndex('by_sessionId', (q: any) => q.eq('sessionId', sessionId))
        .unique();
      if (!current) throw new Error('current session not found');
      // Legacy 2_000 with a newer projection 9_000: reader must return 9_000.
      const projectedDocId = await ctx.db.insert('sessions', {
        sessionId: `lastat-reader-projected-${suffix}`,
        userId: current.userId,
        createdAt: 1_000,
        lastActivityAt: 2_000,
      });
      await upsertSessionLastActivityAt(ctx, projectedDocId, 9_000);
      // Legacy-only session: reader must fall back to 3_000.
      const legacyDocId = await ctx.db.insert('sessions', {
        sessionId: `lastat-reader-legacy-${suffix}`,
        userId: current.userId,
        createdAt: 1_000,
        lastActivityAt: 3_000,
      });
      return { projectedDocId, legacyDocId };
    });

    const result = await t.query(api.sessions.listMySessions, { sessionId });
    expect(result.success).toBe(true);
    const sessions = result.sessions ?? [];
    // Current session stays on top; shape preserved.
    expect(sessions[0]?.isCurrent).toBe(true);
    const projected = sessions.find((s: any) => String(s._id) === String(ids.projectedDocId));
    const legacy = sessions.find((s: any) => String(s._id) === String(ids.legacyDocId));
    expect(projected?.lastActivityAt).toBe(9_000);
    expect(legacy?.lastActivityAt).toBe(3_000);
  });

  test('cliAuth.listUserSessions prefers projection, falls back to legacy', async () => {
    const suffix = Math.random().toString(36).slice(2);
    const { sessionId } = await createTestSession(`lastat-reader-cli-${suffix}`);

    await t.run(async (ctx: any) => {
      const current = await ctx.db
        .query('sessions')
        .withIndex('by_sessionId', (q: any) => q.eq('sessionId', sessionId))
        .unique();
      if (!current) throw new Error('current session not found');
      const projectedPublicId = `lastat-cli-projected-${suffix}`;
      const projectedDocId = await ctx.db.insert('cliSessions', {
        sessionId: projectedPublicId,
        userId: current.userId,
        isActive: true,
        createdAt: 1_000,
        lastUsedAt: 1_000,
      });
      await upsertCliSessionLastUsedAt(ctx, projectedDocId, 5_000);
      await ctx.db.insert('cliSessions', {
        sessionId: `lastat-cli-legacy-${suffix}`,
        userId: current.userId,
        isActive: true,
        createdAt: 1_000,
        lastUsedAt: 2_000,
      });
    });

    const result = await t.query(api.cliAuth.listUserSessions, { sessionId });
    const projected = result.find((s: any) => s.sessionId === `lastat-cli-projected-${suffix}`);
    const legacy = result.find((s: any) => s.sessionId === `lastat-cli-legacy-${suffix}`);
    // Required numeric shape preserved; projection wins when present.
    expect(projected?.lastUsedAt).toBe(5_000);
    expect(legacy?.lastUsedAt).toBe(2_000);
  });

  test('cleanupCliSessions stale pass is projection-driven, handles orphans and inactive', async () => {
    const suffix = Math.random().toString(36).slice(2);
    const { sessionId } = await createTestSession(`lastat-cli-cleanup-${suffix}`);
    const now = Date.now();
    const stale = now - 91 * 24 * 60 * 60 * 1000;

    const ids = await t.run(async (ctx: any) => {
      const current = await ctx.db
        .query('sessions')
        .withIndex('by_sessionId', (q: any) => q.eq('sessionId', sessionId))
        .unique();
      if (!current) throw new Error('current session not found');
      // Fresh legacy parent, stale projection: only the projection scan selects it.
      const staleDocId = await ctx.db.insert('cliSessions', {
        sessionId: `lastat-cli-stale-${suffix}`,
        userId: current.userId,
        isActive: true,
        createdAt: now,
        lastUsedAt: now,
      });
      await upsertCliSessionLastUsedAt(ctx, staleDocId, stale);
      // Inactive parent with stale projection: projection row must go too.
      const inactiveDocId = await ctx.db.insert('cliSessions', {
        sessionId: `lastat-cli-inactive-${suffix}`,
        userId: current.userId,
        isActive: false,
        createdAt: now,
        lastUsedAt: now,
      });
      await upsertCliSessionLastUsedAt(ctx, inactiveDocId, stale);
      // Orphan projection: parent deleted before cleanup runs.
      const orphanDocId = await ctx.db.insert('cliSessions', {
        sessionId: `lastat-cli-orphan-${suffix}`,
        userId: current.userId,
        isActive: true,
        createdAt: now,
        lastUsedAt: now,
      });
      await upsertCliSessionLastUsedAt(ctx, orphanDocId, stale);
      await ctx.db.delete('cliSessions', orphanDocId);
      // Fresh parent + fresh projection: must survive.
      const freshDocId = await ctx.db.insert('cliSessions', {
        sessionId: `lastat-cli-fresh-${suffix}`,
        userId: current.userId,
        isActive: true,
        createdAt: now,
        lastUsedAt: now,
      });
      await upsertCliSessionLastUsedAt(ctx, freshDocId, now);
      return { staleDocId, inactiveDocId, orphanDocId, freshDocId };
    });

    await t.mutation(internal.chatroomCleanup.cleanupCliSessions, {});

    const after = await t.run(async (ctx: any) => {
      const read = async (docId: any) => ({
        parent: await ctx.db.get(docId),
        projection: await ctx.db
          .query('chatroom_cliSessionLastUsedAt')
          .withIndex('by_cliSessionId', (q: any) => q.eq('cliSessionId', docId))
          .unique(),
      });
      return {
        stale: await read(ids.staleDocId),
        inactive: await read(ids.inactiveDocId),
        orphan: await read(ids.orphanDocId),
        fresh: await read(ids.freshDocId),
      };
    });
    expect(after.stale.parent).toBeNull();
    expect(after.stale.projection).toBeNull();
    expect(after.inactive.parent).toBeNull();
    expect(after.inactive.projection).toBeNull();
    expect(after.orphan.projection).toBeNull();
    expect(after.fresh.parent).not.toBeNull();
    expect(after.fresh.projection?.lastUsedAt).toBe(now);
  });

  test('cleanupMachines selects by projection even when legacy is newer', async () => {
    const suffix = Math.random().toString(36).slice(2);
    const { sessionId } = await createTestSession(`lastat-machine-proj-cleanup-${suffix}`);
    const now = Date.now();
    const stale = now - 91 * 24 * 60 * 60 * 1000;
    const staleMachineId = `lastat-mproj-stale-${suffix}`;
    const freshMachineId = `lastat-mproj-fresh-${suffix}`;
    const orphanMachineId = `lastat-mproj-orphan-${suffix}`;

    await t.run(async (ctx: any) => {
      const session = await ctx.db
        .query('sessions')
        .withIndex('by_sessionId', (q: any) => q.eq('sessionId', sessionId))
        .unique();
      if (!session) throw new Error('test session not found');
      // Fresh legacy field, stale projection: only the projection scan selects it.
      await ctx.db.insert('chatroom_machines', {
        machineId: staleMachineId,
        userId: session.userId,
        hostname: 'test-host',
        os: 'darwin',
        availableHarnesses: ['opencode'],
        registeredAt: now,
        lastSeenAt: now,
        daemonConnected: false,
      });
      await upsertMachineLastSeenAt(ctx, staleMachineId, stale);
      // Orphan projection: parent deleted before cleanup runs.
      await ctx.db.insert('chatroom_machines', {
        machineId: orphanMachineId,
        userId: session.userId,
        hostname: 'test-host',
        os: 'darwin',
        availableHarnesses: ['opencode'],
        registeredAt: now,
        lastSeenAt: now,
        daemonConnected: false,
      });
      await upsertMachineLastSeenAt(ctx, orphanMachineId, stale);
      const orphanParent = await ctx.db
        .query('chatroom_machines')
        .withIndex('by_machineId', (q: any) => q.eq('machineId', orphanMachineId))
        .unique();
      await ctx.db.delete('chatroom_machines', orphanParent._id);
      // Fresh parent + fresh projection: must survive.
      await ctx.db.insert('chatroom_machines', {
        machineId: freshMachineId,
        userId: session.userId,
        hostname: 'test-host',
        os: 'darwin',
        availableHarnesses: ['opencode'],
        registeredAt: now,
        lastSeenAt: now,
        daemonConnected: false,
      });
      await upsertMachineLastSeenAt(ctx, freshMachineId, now);
    });

    await t.mutation(internal.chatroomCleanup.cleanupMachines, {});

    const after = await t.run(async (ctx: any) => {
      const read = async (mid: string) => ({
        parent: await ctx.db
          .query('chatroom_machines')
          .withIndex('by_machineId', (q: any) => q.eq('machineId', mid))
          .unique(),
        projection: await ctx.db
          .query('chatroom_machineLastSeenAt')
          .withIndex('by_machineId', (q: any) => q.eq('machineId', mid))
          .unique(),
      });
      return {
        stale: await read(staleMachineId),
        orphan: await read(orphanMachineId),
        fresh: await read(freshMachineId),
      };
    });
    expect(after.stale.parent).toBeNull();
    expect(after.stale.projection).toBeNull();
    expect(after.orphan.projection).toBeNull();
    expect(after.fresh.parent).not.toBeNull();
    expect(after.fresh.projection?.lastSeenAt).toBe(now);
  });
});
