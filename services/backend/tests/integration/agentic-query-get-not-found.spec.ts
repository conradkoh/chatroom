import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import { t } from '../../test.setup';
import { setupWorkspaceForSession } from './direct-harness/fixtures';

describe('web.agenticQuery.queries.get not found', () => {
  test('returns null for deleted queryId', async () => {
    const { sessionId, workspaceId } = await setupWorkspaceForSession('agentic-get-missing');

    const { queryId } = await t.mutation(api.web.agenticQuery.index.createDraft, {
      sessionId,
      workspaceId,
      mode: 'search',
    });

    await t.run(async (ctx) => {
      await ctx.db.delete(queryId);
    });

    const result = await t.query(api.web.agenticQuery.index.get, {
      sessionId,
      queryId,
    });

    expect(result).toBeNull();
  });
});
