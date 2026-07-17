/**
 * agenticQueryCleanup — Integration Tests
 */

import { describe, expect, test } from 'vitest';

import { api, internal } from '../../convex/_generated/api';
import { t } from '../../test.setup';
import { setupWorkspaceForSession } from './direct-harness/fixtures';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

describe('agenticQueryCleanup.cleanupStaleAgenticQueries', () => {
  test('deletes stale completed queries and their turns', async () => {
    const { sessionId, workspaceId } = await setupWorkspaceForSession('agentic-cleanup');

    const { queryId } = await t.mutation(api.web.agenticQuery.index.createDraft, {
      sessionId,
      workspaceId,
      mode: 'search',
    });

    const staleAt = Date.now() - SEVEN_DAYS_MS - 60_000;
    await t.run(async (ctx) => {
      await ctx.db.patch(queryId, {
        status: 'complete',
        lastActiveAt: staleAt,
        createdAt: staleAt,
      });
      await ctx.db.insert('chatroom_agenticQueryTurns', {
        agenticQueryId: queryId,
        seq: 0,
        userMessage: 'old search',
        assistantResponse: 'old answer',
        createdAt: staleAt,
      });
    });

    await t.mutation(internal.agenticQueryCleanup.cleanupStaleAgenticQueries, {});

    const query = await t.run(async (ctx) => ctx.db.get(queryId));
    const turns = await t.run(async (ctx) =>
      ctx.db
        .query('chatroom_agenticQueryTurns')
        .withIndex('by_agenticQueryId', (q) => q.eq('agenticQueryId', queryId))
        .collect()
    );

    expect(query).toBeNull();
    expect(turns).toHaveLength(0);
  });

  test('skips running queries even when stale', async () => {
    const { sessionId, workspaceId } = await setupWorkspaceForSession('agentic-cleanup-running');

    const { queryId } = await t.mutation(api.web.agenticQuery.index.createDraft, {
      sessionId,
      workspaceId,
      mode: 'search',
    });

    const staleAt = Date.now() - SEVEN_DAYS_MS - 60_000;
    await t.run(async (ctx) => {
      await ctx.db.patch(queryId, {
        status: 'running',
        lastActiveAt: staleAt,
      });
    });

    await t.mutation(internal.agenticQueryCleanup.cleanupStaleAgenticQueries, {});

    const query = await t.run(async (ctx) => ctx.db.get(queryId));
    expect(query).not.toBeNull();
    expect(query!.status).toBe('running');
  });

  test('retains recent queries', async () => {
    const { sessionId, workspaceId } = await setupWorkspaceForSession('agentic-cleanup-recent');

    const { queryId } = await t.mutation(api.web.agenticQuery.index.createDraft, {
      sessionId,
      workspaceId,
      mode: 'search',
    });

    await t.mutation(internal.agenticQueryCleanup.cleanupStaleAgenticQueries, {});

    const query = await t.run(async (ctx) => ctx.db.get(queryId));
    expect(query).not.toBeNull();
  });
});
