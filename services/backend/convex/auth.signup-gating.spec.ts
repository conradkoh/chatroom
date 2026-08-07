import type { SessionId } from 'convex-helpers/server/sessions';
import { beforeEach, expect, test, vi } from 'vitest';

import { t } from '../test.setup';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';

const mockAllowedSignupMethods = vi.hoisted(() => ({
  value: ['self'] as string[] | null,
}));

vi.mock('../config/featureFlags', () => ({
  featureFlags: {
    disableLogin: false,
    get allowedSignupMethods() {
      return mockAllowedSignupMethods.value;
    },
  },
}));

const googleProfile = {
  id: 'google-test-user-1',
  email: 'jane@example.com',
  name: 'Jane Doe',
};

async function seedSystemAdmin(): Promise<{ sessionId: SessionId; userId: Id<'users'> }> {
  const sessionId = `admin-${Math.random().toString(36).slice(2)}` as SessionId;
  const userId = await t.run(async (ctx) => {
    const uid = await ctx.db.insert('users', {
      type: 'anonymous',
      name: 'Admin User',
      accessLevel: 'system_admin',
    });
    await ctx.db.insert('sessions', {
      sessionId,
      userId: uid,
      createdAt: Date.now(),
      authMethod: 'anonymous',
    });
    return uid;
  });
  return { sessionId, userId };
}

async function enableGoogleAuth(configuredBy: Id<'users'>): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert('auth_providerConfigs', {
      type: 'google',
      enabled: true,
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
      redirectUris: ['http://localhost/callback'],
      configuredBy,
      configuredAt: Date.now(),
    });
  });
}

beforeEach(() => {
  mockAllowedSignupMethods.value = ['self'];
});

test('loginAnon throws SIGNUP_DISABLED when allowedSignupMethods is null', async () => {
  mockAllowedSignupMethods.value = null;
  const sessionId = `anon-${Math.random().toString(36).slice(2)}` as SessionId;

  await expect(t.mutation(api.auth.loginAnon, { sessionId })).rejects.toMatchObject({
    data: {
      code: 'SIGNUP_DISABLED',
      message: 'Self-signup is not enabled',
    },
  });
});

test('loginAnon throws when only invite signup is allowed', async () => {
  mockAllowedSignupMethods.value = ['invite'];
  const sessionId = `anon-${Math.random().toString(36).slice(2)}` as SessionId;

  await expect(t.mutation(api.auth.loginAnon, { sessionId })).rejects.toMatchObject({
    data: {
      code: 'SIGNUP_DISABLED',
      message: 'Self-signup is not enabled',
    },
  });
});

test('loginAnon succeeds when self signup is allowed', async () => {
  mockAllowedSignupMethods.value = ['self'];
  const sessionId = `anon-${Math.random().toString(36).slice(2)}` as SessionId;

  const result = await t.mutation(api.auth.loginAnon, { sessionId });
  expect(result.success).toBe(true);
});

test('Google new user blocked when signups are fully disabled', async () => {
  mockAllowedSignupMethods.value = null;
  const admin = await seedSystemAdmin();
  await enableGoogleAuth(admin.userId);
  const sessionId = `google-new-${Math.random().toString(36).slice(2)}` as SessionId;

  await expect(
    t.mutation(api.auth.google.loginWithGoogle, {
      sessionId,
      profile: googleProfile,
    })
  ).rejects.toMatchObject({
    data: {
      code: 'SIGNUP_DISABLED',
      message: 'Sign-ups are currently disabled',
    },
  });
});

test('Google new user blocked when invite-only without pending invite', async () => {
  mockAllowedSignupMethods.value = ['invite'];
  const admin = await seedSystemAdmin();
  await enableGoogleAuth(admin.userId);
  const sessionId = `google-new-${Math.random().toString(36).slice(2)}` as SessionId;

  await expect(
    t.mutation(api.auth.google.loginWithGoogle, {
      sessionId,
      profile: googleProfile,
    })
  ).rejects.toMatchObject({
    data: {
      code: 'SIGNUP_DISABLED',
      message: 'Sign-up requires an invite code',
    },
  });
});

test('Google new user succeeds with pending invite and matching email', async () => {
  mockAllowedSignupMethods.value = ['invite'];
  const admin = await seedSystemAdmin();
  await enableGoogleAuth(admin.userId);

  const invite = await t.mutation(api.system.invites.createInvite, {
    sessionId: admin.sessionId,
    inviteeName: 'Jane Doe',
    inviteeEmail: 'jane@example.com',
  });

  const sessionId = `google-invite-${Math.random().toString(36).slice(2)}` as SessionId;
  const validation = await t.mutation(api.system.invites.validateInviteCode, {
    sessionId,
    code: invite.code,
  });
  expect(validation.valid).toBe(true);

  const login = await t.mutation(api.auth.google.loginWithGoogle, {
    sessionId,
    profile: googleProfile,
  });
  expect(login.success).toBe(true);

  const redeemedInvite = await t.run((ctx) => ctx.db.get('invites', invite._id));
  expect(redeemedInvite?.usedAt).toBeDefined();
  expect(redeemedInvite?.usedByUserId).toBe(login.userId);

  const user = await t.run((ctx) => ctx.db.get('users', login.userId));
  expect(user?.type).toBe('full');
  if (user?.type === 'full') {
    expect(user.invitedByInviteId).toBe(invite._id);
  }
});

test('Google new user fails when email does not match invite', async () => {
  mockAllowedSignupMethods.value = ['invite'];
  const admin = await seedSystemAdmin();
  await enableGoogleAuth(admin.userId);

  const invite = await t.mutation(api.system.invites.createInvite, {
    sessionId: admin.sessionId,
    inviteeName: 'Jane Doe',
    inviteeEmail: 'jane@example.com',
  });

  const sessionId = `google-mismatch-${Math.random().toString(36).slice(2)}` as SessionId;
  await t.mutation(api.system.invites.validateInviteCode, {
    sessionId,
    code: invite.code,
  });

  await expect(
    t.mutation(api.auth.google.loginWithGoogle, {
      sessionId,
      profile: {
        ...googleProfile,
        id: 'google-mismatch-user',
        email: 'other@example.com',
      },
    })
  ).rejects.toMatchObject({
    data: {
      code: 'INVITE_EMAIL_MISMATCH',
      message: 'Google account email does not match the invited email address',
    },
  });
});

test('Google existing user login succeeds when signups are fully disabled', async () => {
  mockAllowedSignupMethods.value = null;
  const admin = await seedSystemAdmin();
  await enableGoogleAuth(admin.userId);

  const existingProfile = {
    id: `google-existing-${Math.random().toString(36).slice(2)}`,
    email: `existing-${Math.random().toString(36).slice(2)}@example.com`,
    name: 'Existing User',
  };

  const existingUserId = await t.run(async (ctx) => {
    return ctx.db.insert('users', {
      type: 'full',
      name: existingProfile.name,
      email: existingProfile.email,
      google: existingProfile,
      accessLevel: 'user',
    });
  });

  const sessionId = `google-existing-${Math.random().toString(36).slice(2)}` as SessionId;
  const login = await t.mutation(api.auth.google.loginWithGoogle, {
    sessionId,
    profile: existingProfile,
  });

  expect(login.success).toBe(true);
  expect(login.userId).toBe(existingUserId);
});
