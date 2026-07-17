import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import { t } from '../../test.setup';
import { setupWorkspaceForSession } from './direct-harness/fixtures';

const VALID_RESULT = `## Summary

Found auth handlers.

## Results

- Session validation in chatroomAccess

## Grounding

- \`services/backend/convex/auth/chatroomAccess.ts:43\` — requireChatroomAccess

## Files

- services/backend/convex/auth/chatroomAccess.ts — access checks
`;

describe('web.agenticQuery submit and complete', () => {
  test('submit spawns agentic query run and complete finalizes turn', async () => {
    const { sessionId, chatroomId, workspaceId } = await setupWorkspaceForSession('agentic-e2e');

    const { queryId } = await t.mutation(api.web.agenticQuery.index.createDraft, {
      sessionId,
      workspaceId,
      mode: 'search',
    });

    const submitResult = await t.mutation(api.web.agenticQuery.index.submit, {
      sessionId,
      queryId,
      message: 'How does authentication work?',
      harnessName: 'opencode-sdk',
    });

    expect(submitResult.runId).toBeDefined();

    const running = await t.run(async (ctx) => ctx.db.get(queryId));
    expect(running?.status).toBe('running');
    expect(running?.activeRunId).toBe(submitResult.runId);

    const run = await t.run(async (ctx) =>
      submitResult.runId ? ctx.db.get(submitResult.runId) : null
    );
    expect(run?.opencode?.harnessName).toBe('opencode-sdk');
    expect(run?.opencode?.lastUsedConfig.agent).toBe('build');

    await t.mutation(api.web.agenticQuery.index.complete, {
      sessionId,
      chatroomId,
      queryId,
      result: VALID_RESULT,
    });

    const completed = await t.run(async (ctx) => ctx.db.get(queryId));
    expect(completed?.status).toBe('complete');

    const data = await t.query(api.web.agenticQuery.index.get, { sessionId, queryId });
    expect(data.turns).toHaveLength(1);
    expect(data.turns[0]?.assistantResponse).toContain('## Summary');
  });

  test('submitFollowUp works after complete', async () => {
    const { sessionId, chatroomId, workspaceId } =
      await setupWorkspaceForSession('agentic-followup');

    const { queryId } = await t.mutation(api.web.agenticQuery.index.createDraft, {
      sessionId,
      workspaceId,
      mode: 'search',
    });

    await t.mutation(api.web.agenticQuery.index.submit, {
      sessionId,
      queryId,
      message: 'Find websocket handlers',
      harnessName: 'opencode-sdk',
    });

    await t.mutation(api.web.agenticQuery.index.complete, {
      sessionId,
      chatroomId,
      queryId,
      result: `## Summary\n\nFound.\n\n## Results\n\n- ws\n\n## Files\n\n- a.ts`,
    });

    const followUp = await t.mutation(api.web.agenticQuery.index.submitFollowUp, {
      sessionId,
      queryId,
      message: 'Narrow to server side only',
      harnessName: 'opencode-sdk',
      model: { providerID: 'openai', modelID: 'gpt-4o' },
    });

    expect(followUp.turnSeq).toBe(1);
    const data = await t.query(api.web.agenticQuery.index.get, { sessionId, queryId });
    expect(data.turns).toHaveLength(2);
    expect(data.query.status).toBe('running');
  });
});
