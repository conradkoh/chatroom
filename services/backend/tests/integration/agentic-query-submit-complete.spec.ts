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
  test('submit spawns harness session and complete finalizes turn', async () => {
    const { sessionId, chatroomId, workspaceId } = await setupWorkspaceForSession('agentic-e2e');

    const { queryId } = await t.mutation(api.web.agenticQuery.index.createDraft, {
      sessionId,
      workspaceId,
      mode: 'ask',
    });

    const submitResult = await t.mutation(api.web.agenticQuery.index.submit, {
      sessionId,
      queryId,
      message: 'How does authentication work?',
    });

    expect(submitResult.harnessSessionId).toBeDefined();

    const running = await t.run(async (ctx) => ctx.db.get(queryId));
    expect(running?.status).toBe('running');
    expect(running?.harnessSessionId).toBe(submitResult.harnessSessionId);

    const harness = await t.run(async (ctx) =>
      submitResult.harnessSessionId ? ctx.db.get(submitResult.harnessSessionId) : null
    );
    expect(harness?.purpose).toBe('agentic-query');

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
    });

    expect(followUp.turnSeq).toBe(1);
    const data = await t.query(api.web.agenticQuery.index.get, { sessionId, queryId });
    expect(data.turns).toHaveLength(2);
    expect(data.query.status).toBe('running');
  });
});
