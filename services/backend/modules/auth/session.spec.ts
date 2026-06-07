/**
 * Unit tests for `modules/auth/session.ts`.
 *
 * Covers the four shipping helpers (`getAuthUserId`, `requireAuthUserId`,
 * `getAuthUser`, `requireAuthUser`), the resolver-chaining behavior of
 * `createAuthHelpers`, and asserts the read-cost contract that motivated
 * this module (1× sessions read for the `…UserId` variants, +1× users read
 * for the `…User` variants).
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test, vi } from 'vitest';

import {
  createAuthHelpers,
  defaultSessionResolver,
  getAuthUser,
  getAuthUserId,
  requireAuthUser,
  requireAuthUserId,
  type SessionResolver,
} from './session';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { t } from '../../test.setup';

async function loginFresh(): Promise<{ sessionId: SessionId; userId: Id<'users'> }> {
  const sessionId = `sess-${Math.random().toString(36).slice(2)}` as SessionId;
  const login = await t.mutation(api.auth.loginAnon, { sessionId });
  expect(login.success).toBe(true);
  return { sessionId, userId: login.userId as Id<'users'> };
}

// ─── Default helpers ─────────────────────────────────────────────────────────

describe('getAuthUserId', () => {
  test('returns the userId for a valid session', async () => {
    const { sessionId, userId } = await loginFresh();
    const result = await t.run((ctx) => getAuthUserId(ctx, { sessionId }));
    expect(result).toBe(userId);
  });

  test('returns null for a missing session', async () => {
    const result = await t.run((ctx) => getAuthUserId(ctx, { sessionId: 'nope' as SessionId }));
    expect(result).toBeNull();
  });

  test('reads the sessions table once and never reads the users table', async () => {
    const { sessionId } = await loginFresh();
    const counts = await t.run(async (ctx) => {
      const querySpy = vi.spyOn(ctx.db, 'query');
      const getSpy = vi.spyOn(ctx.db, 'get');
      await getAuthUserId(ctx, { sessionId });
      const sessionsQueries = querySpy.mock.calls.filter((c) => c[0] === 'sessions').length;
      const usersGets = getSpy.mock.calls.filter((c) => c[0] === 'users').length;
      querySpy.mockRestore();
      getSpy.mockRestore();
      return { sessionsQueries, usersGets };
    });
    expect(counts.sessionsQueries).toBe(1);
    expect(counts.usersGets).toBe(0);
  });
});

describe('requireAuthUserId', () => {
  test('returns the userId for a valid session', async () => {
    const { sessionId, userId } = await loginFresh();
    const result = await t.run((ctx) => requireAuthUserId(ctx, { sessionId }));
    expect(result).toBe(userId);
  });

  test('throws ConvexError NOT_AUTHENTICATED for a missing session', async () => {
    await expect(
      t.run((ctx) => requireAuthUserId(ctx, { sessionId: 'nope' as SessionId }))
    ).rejects.toMatchObject({ data: { code: 'NOT_AUTHENTICATED' } });
  });
});

describe('getAuthUser', () => {
  test('returns the full user doc for a valid session', async () => {
    const { sessionId, userId } = await loginFresh();
    const result = await t.run((ctx) => getAuthUser(ctx, { sessionId }));
    expect(result).not.toBeNull();
    expect(result?._id).toBe(userId);
  });

  test('returns null for a missing session', async () => {
    const result = await t.run((ctx) => getAuthUser(ctx, { sessionId: 'nope' as SessionId }));
    expect(result).toBeNull();
  });

  test('reads sessions once and users once on the happy path', async () => {
    const { sessionId } = await loginFresh();
    const counts = await t.run(async (ctx) => {
      const querySpy = vi.spyOn(ctx.db, 'query');
      const getSpy = vi.spyOn(ctx.db, 'get');
      await getAuthUser(ctx, { sessionId });
      const sessionsQueries = querySpy.mock.calls.filter((c) => c[0] === 'sessions').length;
      const usersGets = getSpy.mock.calls.filter((c) => c[0] === 'users').length;
      querySpy.mockRestore();
      getSpy.mockRestore();
      return { sessionsQueries, usersGets };
    });
    expect(counts.sessionsQueries).toBe(1);
    expect(counts.usersGets).toBe(1);
  });
});

describe('requireAuthUser', () => {
  test('returns the full user doc for a valid session', async () => {
    const { sessionId, userId } = await loginFresh();
    const result = await t.run((ctx) => requireAuthUser(ctx, { sessionId }));
    expect(result._id).toBe(userId);
  });

  test('throws ConvexError NOT_AUTHENTICATED for a missing session', async () => {
    await expect(
      t.run((ctx) => requireAuthUser(ctx, { sessionId: 'nope' as SessionId }))
    ).rejects.toMatchObject({ data: { code: 'NOT_AUTHENTICATED' } });
  });
});

// ─── createAuthHelpers — resolver chaining ───────────────────────────────────

describe('createAuthHelpers', () => {
  test('tries resolvers in order and returns the first non-null userId', async () => {
    const { sessionId, userId } = await loginFresh();

    const calls: string[] = [];
    const firstResolver: SessionResolver = async () => {
      calls.push('first');
      return null;
    };
    const secondResolver: SessionResolver = async () => {
      calls.push('second');
      return userId;
    };
    const thirdResolver: SessionResolver = async () => {
      calls.push('third');
      return null;
    };

    const helpers = createAuthHelpers([firstResolver, secondResolver, thirdResolver]);
    const result = await t.run((ctx) => helpers.getAuthUserId(ctx, { sessionId }));

    expect(result).toBe(userId);
    expect(calls).toEqual(['first', 'second']); // third never runs
  });

  test('returns null when no resolver claims the session', async () => {
    const empty: SessionResolver = async () => null;
    const helpers = createAuthHelpers([empty, empty]);
    const result = await t.run((ctx) =>
      helpers.getAuthUserId(ctx, { sessionId: 'nope' as SessionId })
    );
    expect(result).toBeNull();
  });

  test('default resolver round-trips a real session', async () => {
    const { sessionId, userId } = await loginFresh();
    const result = await t.run((ctx) => defaultSessionResolver(ctx, sessionId));
    expect(result).toBe(userId);
  });
});
