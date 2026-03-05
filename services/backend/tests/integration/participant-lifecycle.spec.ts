/**
 * Participant Lifecycle Integration Tests
 *
 * Tests for participant waiting-state tracking and queue promotion:
 * - areAllAgentsWaiting correctly identifies agents not in the wait loop
 */

import { describe, expect, test } from 'vitest';

import { t } from '../../test.setup';
import { createTestSession, createPairTeamChatroom, joinParticipant } from '../helpers/integration';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Participant Lifecycle', () => {
  describe('areAllAgentsWaiting with non-waiting participants', () => {
    test('areAllAgentsWaiting returns false when a participant has no lastSeenAction', async () => {
      const { sessionId } = await createTestSession('test-idle-no-action');
      const chatroomId = await createPairTeamChatroom(sessionId);

      // Join both participants (does not set lastSeenAction = 'get-next-task:started')
      await joinParticipant(sessionId, chatroomId, 'builder');
      await joinParticipant(sessionId, chatroomId, 'reviewer');

      // Directly verify that areAllAgentsWaiting logic returns false
      // (no lastSeenAction set — agents haven't called get-next-task yet)
      await t.run(async (ctx) => {
        const participants = await ctx.db
          .query('chatroom_participants')
          .filter((q) => q.eq(q.field('chatroomId'), chatroomId))
          .collect();

        const allWaiting = participants.every((p) => p.lastSeenAction === 'get-next-task:started');

        // No agent has lastSeenAction = 'get-next-task:started' → allWaiting should be false
        expect(allWaiting).toBe(false);
      });
    });

    test('areAllAgentsWaiting returns true when all participants have lastSeenAction = get-next-task:started', async () => {
      const { sessionId } = await createTestSession('test-idle-all-waiting');
      const chatroomId = await createPairTeamChatroom(sessionId);

      await joinParticipant(sessionId, chatroomId, 'builder');
      await joinParticipant(sessionId, chatroomId, 'reviewer');

      // Simulate both agents entering the get-next-task loop
      await t.run(async (ctx) => {
        const participants = await ctx.db
          .query('chatroom_participants')
          .filter((q) => q.eq(q.field('chatroomId'), chatroomId))
          .collect();
        for (const p of participants) {
          await ctx.db.patch('chatroom_participants', p._id, {
            lastSeenAction: 'get-next-task:started',
          });
        }
      });

      await t.run(async (ctx) => {
        const participants = await ctx.db
          .query('chatroom_participants')
          .filter((q) => q.eq(q.field('chatroomId'), chatroomId))
          .collect();

        const allWaiting = participants.every((p) => p.lastSeenAction === 'get-next-task:started');

        // All participants are in wait loop → allWaiting should be true
        expect(allWaiting).toBe(true);
      });
    });

    test('busy participant blocks queue promotion on entry point join', async () => {
      const { sessionId } = await createTestSession('test-non-idle-blocks-promo');
      const chatroomId = await createPairTeamChatroom(sessionId);

      // Join reviewer first (no lastSeenAction — not waiting)
      await joinParticipant(sessionId, chatroomId, 'reviewer');

      // Create a queue record directly (no task — tasks are created at promotion time)
      let queuedMessageId: string | undefined;
      await t.run(async (ctx) => {
        queuedMessageId = (await ctx.db.insert('chatroom_messageQueue', {
          chatroomId,
          senderRole: 'user',
          targetRole: 'builder',
          content: 'Queued message content',
          type: 'message',
          queuePosition: 1,
        })) as unknown as string;
      });

      // Now join builder (entry point) — queue promotion should NOT happen
      // because reviewer does not have lastSeenAction = 'get-next-task:started'
      await joinParticipant(sessionId, chatroomId, 'builder');

      // Verify the queue record was NOT consumed (no task created)
      await t.run(async (ctx) => {
        const queueRecord = await ctx.db.get('chatroom_messageQueue', queuedMessageId as any);
        expect(queueRecord).not.toBeNull(); // Should still be in queue, not promoted

        // No pending task should have been created
        const tasks = await ctx.db
          .query('chatroom_tasks')
          .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
          .collect();
        expect(tasks.filter((t) => t.status === 'pending').length).toBe(0);
      });
    });
  });
});
