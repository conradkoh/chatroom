import type { SessionId } from 'convex-helpers/server/sessions';
import { beforeEach, expect, test, vi } from 'vitest';

import { t } from '../../test.setup';
import { api } from '../_generated/api';
import type { Id } from '../_generated/dataModel';

const mockAllowedSignupMethods = vi.hoisted(() => ({
  value: ['self', 'invite'] as string[] | null,
}));

vi.mock('../../config/featureFlags', () => ({
  featureFlags: {
    disableLogin: false,
    get allowedSignupMethods() {
      return mockAllowedSignupMethods.value;
    },
  },
}));

const MS_PER_DAY = 24 * 60 * 60 * 1000;

beforeEach(() => {
  mockAllowedSignupMethods.value = ['self', 'invite'];
});

async function loginAsSystemAdmin(): Promise<{ sessionId: SessionId; userId: Id<'users'> }> {
  const sessionId = `admin-${Math.random().toString(36).slice(2)}` as SessionId;
  const login = await t.mutation(api.auth.loginAnon, { sessionId });
  expect(login.success).toBe(true);
  const userId = login.userId as Id<'users'>;
  await t.run(async (ctx) => {
    await ctx.db.patch('users', userId, { accessLevel: 'system_admin' });
  });
  return { sessionId, userId };
}

async function loginAsStandardUser(): Promise<{ sessionId: SessionId; userId: Id<'users'> }> {
  const sessionId = `user-${Math.random().toString(36).slice(2)}` as SessionId;
  const login = await t.mutation(api.auth.loginAnon, { sessionId });
  expect(login.success).toBe(true);
  const userId = login.userId as Id<'users'>;
  await t.run(async (ctx) => {
    await ctx.db.patch('users', userId, { accessLevel: 'user' });
  });
  return { sessionId, userId };
}

async function loginAsBusinessAdmin(): Promise<{ sessionId: SessionId; userId: Id<'users'> }> {
  const sessionId = `biz-admin-${Math.random().toString(36).slice(2)}` as SessionId;
  const login = await t.mutation(api.auth.loginAnon, { sessionId });
  expect(login.success).toBe(true);
  const userId = login.userId as Id<'users'>;
  await t.run(async (ctx) => {
    await ctx.db.patch('users', userId, { accessLevel: 'user', roleNames: ['admin'] });
  });
  return { sessionId, userId };
}

test('business admin with invites:manage can create and list invites', async () => {
  const { sessionId } = await loginAsBusinessAdmin();

  const invite = await t.mutation(api.admin.invites.createInvite, {
    sessionId,
    inviteeName: 'Biz Admin Invite',
    inviteeEmail: 'bizadmin-invite@example.com',
  });
  expect(invite.inviteeEmail).toBe('bizadmin-invite@example.com');

  const invites = await t.query(api.admin.invites.listInvites, { sessionId });
  expect(invites.some((i) => i._id === invite._id)).toBe(true);
});

test('createInvite applies 30-day default expiry', async () => {
  const { sessionId } = await loginAsSystemAdmin();

  const invite = await t.mutation(api.admin.invites.createInvite, {
    sessionId,
    inviteeName: 'Jane Doe',
    inviteeEmail: 'jane@example.com',
  });

  expect(invite.expiresAt).toBeDefined();
  if (invite.expiresAt === undefined) {
    throw new Error('Expected invite to have an expiry');
  }
  expect(invite.expiresAt - invite.createdAt).toBeCloseTo(30 * MS_PER_DAY, -3);
});

test('createInvite supports indefinite expiry', async () => {
  const { sessionId } = await loginAsSystemAdmin();

  const invite = await t.mutation(api.admin.invites.createInvite, {
    sessionId,
    inviteeName: 'Jane Doe',
    inviteeEmail: 'jane@example.com',
    expiry: { type: 'indefinite' },
  });

  expect(invite.expiresAt).toBeUndefined();
});

test('createInvite rejects empty name, empty email, and invalid email', async () => {
  const { sessionId } = await loginAsSystemAdmin();

  await expect(
    t.mutation(api.admin.invites.createInvite, {
      sessionId,
      inviteeName: '   ',
      inviteeEmail: 'jane@example.com',
    })
  ).rejects.toMatchObject({
    data: { code: 'INVALID_INPUT', message: 'Invitee name is required' },
  });

  await expect(
    t.mutation(api.admin.invites.createInvite, {
      sessionId,
      inviteeName: 'Jane Doe',
      inviteeEmail: '   ',
    })
  ).rejects.toMatchObject({
    data: { code: 'INVALID_INPUT', message: 'Invitee email is required' },
  });

  await expect(
    t.mutation(api.admin.invites.createInvite, {
      sessionId,
      inviteeName: 'Jane Doe',
      inviteeEmail: 'not-an-email',
    })
  ).rejects.toMatchObject({
    data: { code: 'INVALID_INPUT', message: 'Invitee email must be a valid email address' },
  });
});

test('disableInvite and enableInvite toggle disabled', async () => {
  const { sessionId } = await loginAsSystemAdmin();

  const invite = await t.mutation(api.admin.invites.createInvite, {
    sessionId,
    inviteeName: 'Jane Doe',
    inviteeEmail: 'jane@example.com',
  });

  const disabled = await t.mutation(api.admin.invites.disableInvite, {
    sessionId,
    inviteId: invite._id,
  });
  expect(disabled.disabled).toBe(true);
  expect(disabled.status).toBe('disabled');

  const enabled = await t.mutation(api.admin.invites.enableInvite, {
    sessionId,
    inviteId: invite._id,
  });
  expect(enabled.disabled).toBe(false);
  expect(enabled.status).toBe('active');
});

test('deleteInvite hard deletes the invite record', async () => {
  const { sessionId } = await loginAsSystemAdmin();

  const invite = await t.mutation(api.admin.invites.createInvite, {
    sessionId,
    inviteeName: 'Jane Doe',
    inviteeEmail: 'jane@example.com',
  });

  await t.mutation(api.admin.invites.deleteInvite, {
    sessionId,
    inviteId: invite._id,
  });

  const deleted = await t.run((ctx) => ctx.db.get('invites', invite._id));
  expect(deleted).toBeNull();
});

test('validateInviteCode returns invite details for a valid code', async () => {
  const { sessionId: adminSessionId } = await loginAsSystemAdmin();
  const validationSessionId = `validate-${Math.random().toString(36).slice(2)}` as SessionId;

  const invite = await t.mutation(api.admin.invites.createInvite, {
    sessionId: adminSessionId,
    inviteeName: 'Jane Doe',
    inviteeEmail: 'jane@example.com',
  });

  const result = await t.mutation(api.admin.invites.validateInviteCode, {
    sessionId: validationSessionId,
    code: invite.code,
  });

  expect(result).toEqual({
    valid: true,
    inviteId: invite._id,
    inviteeName: 'Jane Doe',
  });
});

test('validateInviteCode rejects disabled, expired, and used invites', async () => {
  const { sessionId: adminSessionId } = await loginAsSystemAdmin();
  const validationSessionId = `validate-${Math.random().toString(36).slice(2)}` as SessionId;

  const disabledInvite = await t.mutation(api.admin.invites.createInvite, {
    sessionId: adminSessionId,
    inviteeName: 'Disabled User',
    inviteeEmail: 'disabled@example.com',
  });
  await t.mutation(api.admin.invites.disableInvite, {
    sessionId: adminSessionId,
    inviteId: disabledInvite._id,
  });

  const disabledResult = await t.mutation(api.admin.invites.validateInviteCode, {
    sessionId: validationSessionId,
    code: disabledInvite.code,
  });
  expect(disabledResult).toMatchObject({ valid: false, reason: 'disabled' });

  const expiredInvite = await t.mutation(api.admin.invites.createInvite, {
    sessionId: adminSessionId,
    inviteeName: 'Expired User',
    inviteeEmail: 'expired@example.com',
    expiry: { type: 'days', days: 1 },
  });
  await t.run(async (ctx) => {
    await ctx.db.patch('invites', expiredInvite._id, {
      expiresAt: Date.now() - 1000,
    });
  });

  const expiredResult = await t.mutation(api.admin.invites.validateInviteCode, {
    sessionId: `${validationSessionId}-expired` as SessionId,
    code: expiredInvite.code,
  });
  expect(expiredResult).toMatchObject({ valid: false, reason: 'expired' });

  const usedInvite = await t.mutation(api.admin.invites.createInvite, {
    sessionId: adminSessionId,
    inviteeName: 'Used User',
    inviteeEmail: 'used@example.com',
  });
  await t.run(async (ctx) => {
    await ctx.db.patch('invites', usedInvite._id, {
      usedAt: Date.now(),
    });
  });

  const usedResult = await t.mutation(api.admin.invites.validateInviteCode, {
    sessionId: `${validationSessionId}-used` as SessionId,
    code: usedInvite.code,
  });
  expect(usedResult).toMatchObject({ valid: false, reason: 'used' });
});

test('validateInviteCode records failed attempts and rate limits after 5 failures', async () => {
  const sessionId = `rate-limit-${Math.random().toString(36).slice(2)}` as SessionId;

  for (let i = 0; i < 5; i++) {
    const result = await t.mutation(api.admin.invites.validateInviteCode, {
      sessionId,
      code: 'INVALID1',
    });
    expect(result).toMatchObject({ valid: false, reason: 'invalid_code' });
  }

  const rateLimited = await t.mutation(api.admin.invites.validateInviteCode, {
    sessionId,
    code: 'INVALID1',
  });
  expect(rateLimited).toMatchObject({ valid: false, reason: 'rate_limited' });
  if (!rateLimited.valid) {
    expect(rateLimited.retryAfter).toBeGreaterThan(0);
  }
});

test('createInvite requires invites:manage permission', async () => {
  const { sessionId } = await loginAsStandardUser();

  await expect(
    t.mutation(api.admin.invites.createInvite, {
      sessionId,
      inviteeName: 'Jane Doe',
      inviteeEmail: 'jane@example.com',
    })
  ).rejects.toMatchObject({
    data: {
      code: 'FORBIDDEN',
      message: 'Forbidden: missing permission invites:manage',
    },
  });
});

test('validateInviteCode writes pendingInviteId to session on success', async () => {
  const { sessionId: adminSessionId } = await loginAsSystemAdmin();
  const validationSessionId = `pending-${Math.random().toString(36).slice(2)}` as SessionId;

  const invite = await t.mutation(api.admin.invites.createInvite, {
    sessionId: adminSessionId,
    inviteeName: 'Jane Doe',
    inviteeEmail: 'jane@example.com',
  });

  const result = await t.mutation(api.admin.invites.validateInviteCode, {
    sessionId: validationSessionId,
    code: invite.code,
  });

  expect(result).toMatchObject({
    valid: true,
    inviteId: invite._id,
    inviteeName: 'Jane Doe',
  });

  const session = await t.run(async (ctx) => {
    return ctx.db
      .query('sessions')
      .withIndex('by_sessionId', (q) => q.eq('sessionId', validationSessionId))
      .first();
  });

  expect(session?.pendingInviteId).toBe(invite._id);
  expect(session?.userId).toBeUndefined();
});

test('validateInviteCode accepts dashed input when stored without dashes', async () => {
  const { sessionId: adminSessionId } = await loginAsSystemAdmin();
  const validationSessionId = `normalize-${Math.random().toString(36).slice(2)}` as SessionId;

  const invite = await t.mutation(api.admin.invites.createInvite, {
    sessionId: adminSessionId,
    inviteeName: 'Jane Doe',
    inviteeEmail: 'jane@example.com',
  });

  await t.run(async (ctx) => {
    await ctx.db.patch('invites', invite._id, { code: 'ABCD1234' });
  });

  const result = await t.mutation(api.admin.invites.validateInviteCode, {
    sessionId: validationSessionId,
    code: 'abcd-1234',
  });

  expect(result).toEqual({
    valid: true,
    inviteId: invite._id,
    inviteeName: 'Jane Doe',
  });
});
