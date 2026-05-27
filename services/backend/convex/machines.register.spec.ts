/**
 * machines.register — rejects cross-user reuse of the same machineId.
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { expect, test } from 'vitest';

import { t } from '../test.setup';
import { api } from './_generated/api';

async function createTestSession(id: string) {
  const login = await t.mutation(api.auth.loginAnon, { sessionId: id as SessionId });
  expect(login.success).toBe(true);
  return { sessionId: id as SessionId };
}

test('register rejects when machineId is already owned by another user', async () => {
  const { sessionId: sessionA } = await createTestSession('register-cross-user-a');
  const { sessionId: sessionB } = await createTestSession('register-cross-user-b');

  const machineId = 'shared-machine-id-cross-user';

  await t.mutation(api.machines.register, {
    sessionId: sessionA,
    machineId,
    hostname: 'host-a',
    os: 'linux',
    availableHarnesses: ['opencode'],
  });

  await expect(
    t.mutation(api.machines.register, {
      sessionId: sessionB,
      machineId,
      hostname: 'host-b',
      os: 'linux',
      availableHarnesses: ['opencode'],
    })
  ).rejects.toThrow(/already registered to another user/);
});

test('register allows same user to re-register with updated hostname', async () => {
  const { sessionId } = await createTestSession('register-same-user-rename');
  const machineId = 'same-user-machine-rename';

  const first = await t.mutation(api.machines.register, {
    sessionId,
    machineId,
    hostname: 'laptop-a',
    os: 'linux',
    availableHarnesses: ['opencode'],
  });
  expect(first.isNew).toBe(true);

  const second = await t.mutation(api.machines.register, {
    sessionId,
    machineId,
    hostname: 'laptop-b',
    os: 'linux',
    availableHarnesses: ['opencode'],
  });
  expect(second.isNew).toBe(false);
});
