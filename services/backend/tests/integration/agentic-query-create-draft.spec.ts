/**
 * createDraft mutation — Integration Tests
 *
 * Verifies session-based chatroom auth (requireChatroomAccess) and draft creation.
 */

import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import { t } from '../../test.setup';
import { setupWorkspaceForSession } from './direct-harness/fixtures';

describe('web.agenticQuery.index.createDraft', () => {
  test('creates a search draft for an authenticated workspace owner', async () => {
    const { sessionId, workspaceId } = await setupWorkspaceForSession('agentic-search');

    const result = await t.mutation(api.web.agenticQuery.index.createDraft, {
      sessionId,
      workspaceId,
      mode: 'search',
    });

    const query = await t.run(async (ctx) => ctx.db.get(result.queryId));
    expect(query).toBeDefined();
    expect(query!.workspaceId).toBe(workspaceId);
    expect(query!.status).toBe('draft');
    expect(query!.mode).toBe('search');
    expect(query!.title).toBe('Agentic Search');
    expect(query!.createdBy).toBeDefined();
  });

  test('legacy ask mode still stores mode but uses unified title', async () => {
    const { sessionId, workspaceId } = await setupWorkspaceForSession('agentic-ask');

    const result = await t.mutation(api.web.agenticQuery.index.createDraft, {
      sessionId,
      workspaceId,
      mode: 'ask',
    });

    const query = await t.run(async (ctx) => ctx.db.get(result.queryId));
    expect(query!.mode).toBe('ask');
    expect(query!.title).toBe('Agentic Search');
  });

  test('rejects when workspace does not exist', async () => {
    const { sessionId, workspaceId } = await setupWorkspaceForSession('agentic-missing-ws');

    await t.run(async (ctx) => {
      await ctx.db.delete(workspaceId);
    });

    await expect(
      t.mutation(api.web.agenticQuery.index.createDraft, {
        sessionId,
        workspaceId,
        mode: 'search',
      })
    ).rejects.toThrow(/Workspace not found/);
  });

  test('rejects when session is not authenticated', async () => {
    const { workspaceId } = await setupWorkspaceForSession('agentic-no-session');

    await expect(
      t.mutation(api.web.agenticQuery.index.createDraft, {
        sessionId: 'unauthenticated-session' as never,
        workspaceId,
        mode: 'search',
      })
    ).rejects.toThrow(/Authentication failed/);
  });
});
