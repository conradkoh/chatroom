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

test('updateUserRoles throws FORBIDDEN when demoting the only system admin', async () => {
  const { sessionId, userId } = await loginAsSystemAdmin();

  await expect(
    t.mutation(api.system.users.updateUserRoles, {
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

  await t.mutation(api.system.users.updateUserRoles, {
    sessionId: admin1.sessionId,
    userId: admin1.userId,
    effectiveRole: 'standard_user',
  });

  const user = await t.run((ctx) => ctx.db.get('users', admin1.userId));
  expect(user?.accessLevel).toBe('user');
  expect(user?.roleNames).toEqual(['user']);

  // admin2 should still be system_admin
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

  const users = await t.query(api.system.users.listUsers, { sessionId });
  const target = users.find((u) => u._id === targetUserId);
  expect(target?.effectiveRole).toBe('standard_user');
});
