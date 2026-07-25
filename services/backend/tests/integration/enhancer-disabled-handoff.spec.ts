/**
 * Enhancer disabled — handoff behaviour should be normal.
 */

import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { t } from '../../test.setup';
import { joinParticipant } from '../helpers/integration';
import { setupWorkspaceForSession } from './direct-harness/fixtures';

describe('enhancer disabled handoff', () => {
  test('planner handoff to builder succeeds when enhancer disabled', async () => {
    const { sessionId, chatroomId } = await setupWorkspaceForSession('enh-off-handoff');
    await joinParticipant(sessionId, chatroomId, 'planner');
    await joinParticipant(sessionId, chatroomId, 'builder');

    // Create a planner task so the handoff can complete it
    await t.run(async (ctx) => {
      const msgId = await ctx.db.insert('chatroom_messages', {
        chatroomId,
        senderRole: 'user',
        content: 'Build feature X',
        targetRole: 'planner',
        type: 'message',
      });
      await ctx.db.insert('chatroom_tasks', {
        chatroomId,
        createdBy: 'user',
        content: 'Build feature X',
        status: 'in_progress',
        assignedTo: 'planner',
        sourceMessageId: msgId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        queuePosition: 1,
      });
    });

    const result = await t.mutation(api.messages.handoff, {
      sessionId,
      chatroomId,
      senderRole: 'planner',
      targetRole: 'builder',
      content: 'Direct delegation',
    });
    expect(result.success).toBe(true);
  });
});
