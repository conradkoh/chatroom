import type { SessionId } from 'convex-helpers/server/sessions';
import { afterEach, expect, test, vi } from 'vitest';

import { t } from '../test.setup';
import { api } from './_generated/api';

afterEach(() => {
  vi.unstubAllEnvs();
});

test('promoteSessionToSystemAdmin throws FORBIDDEN when env disabled', async () => {
  const sessionId = `e2e-forbidden-${Math.random().toString(36).slice(2)}` as SessionId;
  await t.mutation(api.auth.loginAnon, { sessionId });

  await expect(
    t.mutation(api.e2e.promoteSessionToSystemAdmin, { sessionId })
  ).rejects.toMatchObject({
    data: { code: 'FORBIDDEN' },
  });
});

test('promoteSessionToSystemAdmin promotes user when env enabled', async () => {
  vi.stubEnv('E2E_SEEDING_ENABLED', 'true');
  const sessionId = `e2e-promote-${Math.random().toString(36).slice(2)}` as SessionId;
  const login = await t.mutation(api.auth.loginAnon, { sessionId });
  expect(login.success).toBe(true);
  expect(login.userId).toBeDefined();

  const result = await t.mutation(api.e2e.promoteSessionToSystemAdmin, { sessionId });
  expect(result.success).toBe(true);

  const user = await t.run((ctx) => ctx.db.get('users', login.userId));
  expect(user?.accessLevel).toBe('system_admin');
});
