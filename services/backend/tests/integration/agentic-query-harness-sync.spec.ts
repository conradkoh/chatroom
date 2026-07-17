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

describe('agentic query run sync', () => {
  test('finalizeAssistantTurn auto-completes agentic query with valid markdown', async () => {
    const { sessionId, workspaceId } = await setupWorkspaceForSession('agentic-sync');

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
      model: { providerID: 'opencode', modelID: 'big-pickle' },
    });

    const runId = submitResult.runId;
    expect(runId).toBeDefined();

    const run = await t.run(async (ctx) => ctx.db.get(runId!));
    expect(run?.opencode?.lastUsedConfig.agent).toBe('build');

    const { turnId } = await t.mutation(api.daemon.agenticQuery.turns.beginAssistantTurn, {
      sessionId,
      runId: runId!,
    });

    await t.mutation(api.daemon.agenticQuery.messages.appendMessages, {
      sessionId,
      runId: runId!,
      chunks: [
        { content: VALID_RESULT, timestamp: Date.now(), messageId: 'msg-1', partType: 'text' },
      ],
    });

    await t.mutation(api.daemon.agenticQuery.turns.bindTurnMessageId, {
      sessionId,
      turnId,
      messageId: 'msg-1',
    });

    await t.mutation(api.daemon.agenticQuery.turns.finalizeAssistantTurn, {
      sessionId,
      turnId,
    });

    const completed = await t.query(api.web.agenticQuery.index.get, { sessionId, queryId });
    expect(completed.query.status).toBe('complete');
    expect(completed.turns[0]?.assistantResponse).toContain('## Summary');
  });

  test('finalizeAssistantTurn aggregates text from later opencode messageId', async () => {
    const { sessionId, workspaceId } = await setupWorkspaceForSession('agentic-multi-msg');

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
      model: { providerID: 'opencode', modelID: 'big-pickle' },
    });

    const runId = submitResult.runId!;

    const { turnId } = await t.mutation(api.daemon.agenticQuery.turns.beginAssistantTurn, {
      sessionId,
      runId,
    });

    await t.mutation(api.daemon.agenticQuery.messages.appendMessages, {
      sessionId,
      runId,
      chunks: [
        {
          content: 'Thinking about auth...',
          timestamp: Date.now(),
          messageId: 'msg-reasoning',
          partType: 'reasoning',
        },
      ],
    });

    await t.mutation(api.daemon.agenticQuery.turns.bindTurnMessageId, {
      sessionId,
      turnId,
      messageId: 'msg-reasoning',
    });

    await t.mutation(api.daemon.agenticQuery.messages.appendMessages, {
      sessionId,
      runId,
      chunks: [
        { content: VALID_RESULT, timestamp: Date.now(), messageId: 'msg-text', partType: 'text' },
      ],
    });

    await t.mutation(api.daemon.agenticQuery.turns.finalizeAssistantTurn, {
      sessionId,
      turnId,
    });

    const completed = await t.query(api.web.agenticQuery.index.get, { sessionId, queryId });
    expect(completed.query.status).toBe('complete');
    expect(completed.turns[0]?.assistantResponse).toContain('## Summary');
  });

  test('syncFromHarness completes running query from run turn markdown', async () => {
    const { sessionId, workspaceId } = await setupWorkspaceForSession('agentic-sync-web');

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
      model: { providerID: 'opencode', modelID: 'big-pickle' },
    });

    const runId = submitResult.runId!;

    const { turnId } = await t.mutation(api.daemon.agenticQuery.turns.beginAssistantTurn, {
      sessionId,
      runId,
    });

    await t.mutation(api.daemon.agenticQuery.messages.appendMessages, {
      sessionId,
      runId,
      chunks: [
        { content: VALID_RESULT, timestamp: Date.now(), messageId: 'msg-sync', partType: 'text' },
      ],
    });

    await t.mutation(api.daemon.agenticQuery.turns.bindTurnMessageId, {
      sessionId,
      turnId,
      messageId: 'msg-sync',
    });

    await t.mutation(api.daemon.agenticQuery.turns.finalizeAssistantTurn, {
      sessionId,
      turnId,
    });

    await t.run(async (ctx) => {
      await ctx.db.patch(queryId, { status: 'running' });
    });

    const syncResult = await t.mutation(api.web.agenticQuery.mutations.syncFromHarness, {
      sessionId,
      queryId,
    });

    expect(syncResult.synced).toBe(true);
    expect(syncResult.status).toBe('complete');

    const completed = await t.query(api.web.agenticQuery.index.get, { sessionId, queryId });
    expect(completed.query.status).toBe('complete');
  });
});
