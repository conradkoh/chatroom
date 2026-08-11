import type { SessionId } from 'convex-helpers/server/sessions';
import { expect, test } from 'vitest';

import { t } from '../../test.setup';
import { api } from '../_generated/api';
import type { Id } from '../_generated/dataModel';

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

async function createStandardUser(): Promise<{ sessionId: SessionId; userId: Id<'users'> }> {
  const sessionId = `user-${Math.random().toString(36).slice(2)}` as SessionId;
  const login = await t.mutation(api.auth.loginAnon, { sessionId });
  expect(login.success).toBe(true);
  const userId = login.userId as Id<'users'>;
  await t.run(async (ctx) => {
    await ctx.db.patch('users', userId, { accessLevel: 'user', roleNames: ['user'] });
  });
  return { sessionId, userId };
}

test('updateUserRoles throws FORBIDDEN when demoting the only system admin', async () => {
  const { sessionId, userId } = await loginAsSystemAdmin();

  await expect(
    t.mutation(api.admin.users.updateUserRoles, {
      sessionId,
      userId,
      effectiveRole: 'standard_user',
    })
  ).rejects.toMatchObject({
    data: {
      code: 'FORBIDDEN',
      message: 'Cannot remove the last system administrator',
    },
  });
});

test('updateUserRoles allows demoting a system admin when another admin exists', async () => {
  const admin1 = await loginAsSystemAdmin();
  const admin2 = await loginAsSystemAdmin();

  await t.mutation(api.admin.users.updateUserRoles, {
    sessionId: admin1.sessionId,
    userId: admin1.userId,
    effectiveRole: 'standard_user',
  });

  const user = await t.run((ctx) => ctx.db.get('users', admin1.userId));
  expect(user?.accessLevel).toBe('user');
  expect(user?.roleNames).toEqual(['user']);

  const admin2User = await t.run((ctx) => ctx.db.get('users', admin2.userId));
  expect(admin2User?.accessLevel).toBe('system_admin');
});

test('listUsers maps legacy manager roleNames to standard_user effectiveRole', async () => {
  const { sessionId } = await loginAsSystemAdmin();
  const targetSessionId = `mgr-${Math.random().toString(36).slice(2)}` as SessionId;
  const login = await t.mutation(api.auth.loginAnon, { sessionId: targetSessionId });
  const targetUserId = login.userId as Id<'users'>;
  await t.run(async (ctx) => {
    await ctx.db.patch('users', targetUserId, {
      accessLevel: 'user',
      roleNames: ['user', 'manager'],
    });
  });

  const users = await t.query(api.admin.users.listUsers, { sessionId });
  const target = users.find((u) => u._id === targetUserId);
  expect(target?.effectiveRole).toBe('standard_user');
});

test('listUsers excludes system_admin users for business admin actor', async () => {
  const systemAdmin = await loginAsSystemAdmin();
  const businessAdmin = await loginAsBusinessAdmin();

  const users = await t.query(api.admin.users.listUsers, { sessionId: businessAdmin.sessionId });
  const systemAdminEntry = users.find((u) => u._id === systemAdmin.userId);
  expect(systemAdminEntry).toBeUndefined();
});

test('updateUserRoles blocks business admin from promoting to system_admin', async () => {
  const businessAdmin = await loginAsBusinessAdmin();
  const target = await createStandardUser();

  await expect(
    t.mutation(api.admin.users.updateUserRoles, {
      sessionId: businessAdmin.sessionId,
      userId: target.userId,
      effectiveRole: 'system_admin',
    })
  ).rejects.toMatchObject({
    data: {
      code: 'FORBIDDEN',
      message: 'Only system administrators can manage the system administrator role',
    },
  });
});

test('updateUserRoles blocks business admin from demoting system_admin target', async () => {
  const businessAdmin = await loginAsBusinessAdmin();
  const systemAdmin = await loginAsSystemAdmin();

  await expect(
    t.mutation(api.admin.users.updateUserRoles, {
      sessionId: businessAdmin.sessionId,
      userId: systemAdmin.userId,
      effectiveRole: 'standard_user',
    })
  ).rejects.toMatchObject({
    data: {
      code: 'FORBIDDEN',
      message: 'Only system administrators can manage the system administrator role',
    },
  });
});

test('updateUserRoles blocks business admin from changing system_admin target to admin', async () => {
  const businessAdmin = await loginAsBusinessAdmin();
  const systemAdmin = await loginAsSystemAdmin();

  await expect(
    t.mutation(api.admin.users.updateUserRoles, {
      sessionId: businessAdmin.sessionId,
      userId: systemAdmin.userId,
      effectiveRole: 'admin',
    })
  ).rejects.toMatchObject({
    data: {
      code: 'FORBIDDEN',
      message: 'Only system administrators can manage the system administrator role',
    },
  });
});

test('updateUserRoles allows business admin to assign admin and standard_user presets', async () => {
  const businessAdmin = await loginAsBusinessAdmin();
  const target = await createStandardUser();

  await t.mutation(api.admin.users.updateUserRoles, {
    sessionId: businessAdmin.sessionId,
    userId: target.userId,
    effectiveRole: 'admin',
  });

  const asAdmin = await t.run((ctx) => ctx.db.get('users', target.userId));
  expect(asAdmin?.accessLevel).toBe('user');
  expect(asAdmin?.roleNames).toEqual(['admin']);

  await t.mutation(api.admin.users.updateUserRoles, {
    sessionId: businessAdmin.sessionId,
    userId: target.userId,
    effectiveRole: 'standard_user',
  });

  const asStandard = await t.run((ctx) => ctx.db.get('users', target.userId));
  expect(asStandard?.accessLevel).toBe('user');
  expect(asStandard?.roleNames).toEqual(['user']);
});

test('system admin listUsers includes system_admin users and can assign system_admin', async () => {
  const systemAdmin = await loginAsSystemAdmin();
  const target = await createStandardUser();

  const users = await t.query(api.admin.users.listUsers, { sessionId: systemAdmin.sessionId });
  expect(users.some((u) => u._id === systemAdmin.userId)).toBe(true);

  await t.mutation(api.admin.users.updateUserRoles, {
    sessionId: systemAdmin.sessionId,
    userId: target.userId,
    effectiveRole: 'system_admin',
  });

  const promoted = await t.run((ctx) => ctx.db.get('users', target.userId));
  expect(promoted?.accessLevel).toBe('system_admin');
});
