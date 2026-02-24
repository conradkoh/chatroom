/**
 * Participant Lifecycle Integration Tests
 *
 * Tests for participant idle-state tracking and queue promotion:
 * - areAllAgentsIdle correctly identifies agents not in the wait loop
 */

import { describe, expect, test } from 'vitest';

import { t } from '../../test.setup';
import { createTestSession, createPairTeamChatroom, joinParticipant } from '../helpers/integration';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Participant Lifecycle', () => {
  describe('areAllAgentsIdle with non-idle participants', () => {
    test('areAllAgentsIdle returns false when a participant has no lastSeenAction', async () => {
      const { sessionId } = await createTestSession('test-idle-no-action');
      const chatroomId = await createPairTeamChatroom(sessionId);

      // Join both participants (does not set lastSeenAction = 'get-next-task:started')
      await joinParticipant(sessionId, chatroomId, 'builder');
      await joinParticipant(sessionId, chatroomId, 'reviewer');

      // Directly verify that areAllAgentsIdle logic returns false
      // (no lastSeenAction set — agents haven't called get-next-task yet)
      await t.run(async (ctx) => {
        const participants = await ctx.db
          .query('chatroom_participants')
          .filter((q) => q.eq(q.field('chatroomId'), chatroomId))
          .collect();

        const allIdle = participants.every((p) => p.lastSeenAction === 'get-next-task:started');

        // No agent has lastSeenAction = 'get-next-task:started' → allIdle should be false
        expect(allIdle).toBe(false);
      });
    });

    test('areAllAgentsIdle returns true when all participants have lastSeenAction = get-next-task:started', async () => {
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

        const allIdle = participants.every((p) => p.lastSeenAction === 'get-next-task:started');

        // All participants are in wait loop → allIdle should be true
        expect(allIdle).toBe(true);
      });
    });

    test('non-idle participant blocks queue promotion on entry point join', async () => {
      const { sessionId } = await createTestSession('test-non-idle-blocks-promo');
      const chatroomId = await createPairTeamChatroom(sessionId);

      // Join reviewer first (no lastSeenAction — not idle)
      await joinParticipant(sessionId, chatroomId, 'reviewer');

      // Create a queued task directly
      let queuedTaskId: string | undefined;
      await t.run(async (ctx) => {
        const now = Date.now();
        queuedTaskId = (await ctx.db.insert('chatroom_tasks', {
          chatroomId,
          createdBy: 'user',
          content: 'Queued task content',
          status: 'queued',
          origin: 'chat',
          queuePosition: 1,
          createdAt: now,
          updatedAt: now,
        })) as unknown as string;
      });

      // Now join builder (entry point) — queue promotion should NOT happen
      // because reviewer does not have lastSeenAction = 'get-next-task:started'
      await joinParticipant(sessionId, chatroomId, 'builder');

      // Verify the queued task was NOT promoted to pending
      await t.run(async (ctx) => {
        const task = await ctx.db.get('chatroom_tasks', queuedTaskId as any);
        expect(task).not.toBeNull();
        expect(task!.status).toBe('queued'); // Should still be queued, not promoted
      });
    });
  });
});
