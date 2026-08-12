/**
 * harnesses.listModels — serves the server-curated model catalog to
 * authenticated sessions, rejects without one.
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { expect, test } from 'vitest';

import { t } from '../test.setup';
import { api } from './_generated/api';
import { HARNESS_MODEL_CATALOG } from '../src/domain/entities/harness/model-catalog';

async function createTestSession(id: string) {
  const login = await t.mutation(api.auth.loginAnon, { sessionId: id as SessionId });
  expect(login.success).toBe(true);
  return { sessionId: id as SessionId };
}

test.each([
  ['codexSdk', 'codex-sdk'],
  ['copilot', 'copilot'],
  ['claude', 'claude'],
  ['claudeSdk', 'claude-sdk'],
] as const)(
  'listModels(%s) serves the catalog to an authenticated session',
  async (endpoint, harness) => {
    const { sessionId } = await createTestSession(`harness-catalog-${harness}`);
    const models = await t.query(api.harnesses[endpoint].listModels, { sessionId });
    expect(models).toEqual([...HARNESS_MODEL_CATALOG[harness]]);
  }
);

test('listModels rejects without a valid session', async () => {
  await expect(
    t.query(api.harnesses.codexSdk.listModels, { sessionId: 'bogus-session' as SessionId })
  ).rejects.toThrow();
});
