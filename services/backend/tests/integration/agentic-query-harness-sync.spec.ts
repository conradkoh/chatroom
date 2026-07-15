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

describe('agentic query harness sync', () => {
  test('finalizeAssistantTurn auto-completes agentic query with valid markdown', async () => {
    const { sessionId, workspaceId } = await setupWorkspaceForSession('agentic-sync');

    const { queryId } = await t.mutation(api.web.agenticQuery.index.createDraft, {
      sessionId,
      workspaceId,
      mode: 'ask',
    });

    const submitResult = await t.mutation(api.web.agenticQuery.index.submit, {
      sessionId,
      queryId,
      message: 'How does authentication work?',
      harnessName: 'opencode-sdk',
      model: { providerID: 'opencode', modelID: 'big-pickle' },
    });

    const harnessSessionId = submitResult.harnessSessionId;
    expect(harnessSessionId).toBeDefined();

    const harness = await t.run(async (ctx) => ctx.db.get(harnessSessionId!));
    expect(harness?.opencode?.lastUsedConfig.agent).toBe('build');
    expect(harness?.purpose).toBe('agentic-query');

    const { turnId } = await t.mutation(api.daemon.directHarness.turns.beginAssistantTurn, {
      sessionId,
      harnessSessionId: harnessSessionId!,
    });

    await t.mutation(api.daemon.directHarness.messages.appendMessages, {
      sessionId,
      harnessSessionId: harnessSessionId!,
      chunks: [
        { content: VALID_RESULT, timestamp: Date.now(), messageId: 'msg-1', partType: 'text' },
      ],
    });

    await t.mutation(api.daemon.directHarness.turns.bindTurnMessageId, {
      sessionId,
      turnId,
      messageId: 'msg-1',
    });

    await t.mutation(api.daemon.directHarness.turns.finalizeAssistantTurn, {
      sessionId,
      turnId,
    });

    const completed = await t.query(api.web.agenticQuery.index.get, { sessionId, queryId });
    expect(completed.query.status).toBe('complete');
    expect(completed.turns[0]?.assistantResponse).toContain('## Summary');
  });
});
