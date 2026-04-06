/**
 * Materialized Task Counts Integration Tests
 *
 * Tests that task mutations correctly update the chatroom_taskCounts table.
 */

import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import { t } from '../../test.setup';
import { createTestSession, createPairTeamChatroom } from '../helpers/integration';

describe('Materialized Task Counts', () => {
  test('creating a task increments pending count', async () => {
    const { sessionId } = await createTestSession('test-tc-1');
    const chatroomId = await createPairTeamChatroom(sessionId);

    // Send a user message which creates a pending task
    await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      senderRole: 'user',
      content: 'test message',
      type: 'message',
    });

    // Check materialized counts
    const counts = await t.run(async (ctx) => {
      return await ctx.db
        .query('chatroom_taskCounts')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .first();
    });

    expect(counts).not.toBeNull();
    expect(counts!.pending).toBeGreaterThanOrEqual(1);
  });

  test('getTaskCounts reads from materialized counts', async () => {
    const { sessionId } = await createTestSession('test-tc-2');
    const chatroomId = await createPairTeamChatroom(sessionId);

    // Send a message to create a task
    await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      senderRole: 'user',
      content: 'another test message',
      type: 'message',
    });

    // Query via the public API
    const result = await t.query(api.tasks.getTaskCounts, {
      sessionId,
      chatroomId,
    });

    // Should have at least 1 pending task
    expect(result.pending).toBeGreaterThanOrEqual(1);
  });
});
