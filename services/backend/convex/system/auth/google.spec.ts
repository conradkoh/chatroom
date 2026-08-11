import type { SessionId } from 'convex-helpers/server/sessions';
import { expect, test } from 'vitest';

import { t } from '../../../test.setup';
import { api } from '../../_generated/api';
import type { Id } from '../../_generated/dataModel';

async function loginAsSystemAdmin(): Promise<{ sessionId: SessionId }> {
  const sessionId = `sys-admin-${Math.random().toString(36).slice(2)}` as SessionId;
  const login = await t.mutation(api.auth.loginAnon, { sessionId });
  expect(login.success).toBe(true);
  await t.run(async (ctx) => {
    await ctx.db.patch('users', login.userId as Id<'users'>, { accessLevel: 'system_admin' });
  });
  return { sessionId };
}

async function loginAsBusinessAdmin(): Promise<{ sessionId: SessionId }> {
  const sessionId = `biz-admin-${Math.random().toString(36).slice(2)}` as SessionId;
  const login = await t.mutation(api.auth.loginAnon, { sessionId });
  expect(login.success).toBe(true);
  await t.run(async (ctx) => {
    await ctx.db.patch('users', login.userId as Id<'users'>, {
      accessLevel: 'user',
      roleNames: ['admin'],
    });
  });
  return { sessionId };
}

test('getConfig allows system admin', async () => {
  const { sessionId } = await loginAsSystemAdmin();
  const config = await t.query(api.system.auth.google.getConfig, { sessionId });
  expect(config).toBeNull(); // no config yet — should not throw
});

test('getConfig blocks business admin', async () => {
  const { sessionId } = await loginAsBusinessAdmin();
  await expect(t.query(api.system.auth.google.getConfig, { sessionId })).rejects.toMatchObject({
    data: {
      code: 'FORBIDDEN',
      message: 'Forbidden: missing permission system_admin:access',
    },
  });
});
