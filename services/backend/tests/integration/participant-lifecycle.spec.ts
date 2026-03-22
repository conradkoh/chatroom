/**
 * Participant Lifecycle Integration Tests
 *
 * Tests for participant waiting-state tracking and queue promotion:
 * - areAllAgentsWaiting correctly identifies agents not in the wait loop
 */

import { describe, expect, test } from 'vitest';

import { areAllAgentsWaiting } from '../../convex/auth/cliSessionAuth';
import { isActiveParticipant } from '../../src/domain/entities/participant';
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

    test('entry point join promotes queued task when no active tasks exist (regardless of participant state)', async () => {
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

      // Now join builder (entry point) — queue promotion SHOULD happen
      // because no active tasks exist. The canPromote guard uses task state
      // (not participant state) as the source of truth.
      await joinParticipant(sessionId, chatroomId, 'builder');

      // Verify the queue record WAS consumed (task created from promotion)
      await t.run(async (ctx) => {
        const queueRecord = await ctx.db.get('chatroom_messageQueue', queuedMessageId as any);
        expect(queueRecord).toBeNull(); // Promoted — no longer in queue

        // A pending task should have been created from the queued message
        const tasks = await ctx.db
          .query('chatroom_tasks')
          .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
          .collect();
        expect(tasks.filter((t) => t.status === 'pending').length).toBe(1);
      });
    });
  });

  describe('areAllAgentsWaiting with exited participants', () => {
    test('areAllAgentsWaiting returns true when one participant is waiting and one is exited', async () => {
      const { sessionId } = await createTestSession('test-exited-one-waiting');
      const chatroomId = await createPairTeamChatroom(sessionId);

      await joinParticipant(sessionId, chatroomId, 'builder');
      await joinParticipant(sessionId, chatroomId, 'reviewer');

      await t.run(async (ctx) => {
        const builder = await ctx.db
          .query('chatroom_participants')
          .withIndex('by_chatroom_and_role', (q) =>
            q.eq('chatroomId', chatroomId).eq('role', 'builder')
          )
          .unique();
        await ctx.db.patch(builder!._id, { lastSeenAction: 'get-next-task:started' });

        const reviewer = await ctx.db
          .query('chatroom_participants')
          .withIndex('by_chatroom_and_role', (q) =>
            q.eq('chatroomId', chatroomId).eq('role', 'reviewer')
          )
          .unique();
        await ctx.db.patch(reviewer!._id, { lastSeenAction: 'exited' });
      });

      const result = await t.run(async (ctx) => {
        return areAllAgentsWaiting(ctx, chatroomId);
      });
      expect(result).toBe(true);
    });

    test('areAllAgentsWaiting returns false when all participants are exited (no active participants)', async () => {
      const { sessionId } = await createTestSession('test-exited-all');
      const chatroomId = await createPairTeamChatroom(sessionId);

      await joinParticipant(sessionId, chatroomId, 'builder');
      await joinParticipant(sessionId, chatroomId, 'reviewer');

      await t.run(async (ctx) => {
        const participants = await ctx.db
          .query('chatroom_participants')
          .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
          .collect();
        for (const p of participants) {
          await ctx.db.patch(p._id, { lastSeenAction: 'exited' });
        }
      });

      const result = await t.run(async (ctx) => {
        return areAllAgentsWaiting(ctx, chatroomId);
      });
      expect(result).toBe(false);
    });

    test('areAllAgentsWaiting returns true when all active participants are waiting, ignoring exited', async () => {
      const { sessionId } = await createTestSession('test-exited-ignore');
      const chatroomId = await createPairTeamChatroom(sessionId);

      await joinParticipant(sessionId, chatroomId, 'builder');
      await joinParticipant(sessionId, chatroomId, 'reviewer');

      await t.run(async (ctx) => {
        const participants = await ctx.db
          .query('chatroom_participants')
          .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
          .collect();
        for (const p of participants) {
          await ctx.db.patch(p._id, { lastSeenAction: 'get-next-task:started' });
        }
      });

      await t.run(async (ctx) => {
        const reviewer = await ctx.db
          .query('chatroom_participants')
          .withIndex('by_chatroom_and_role', (q) =>
            q.eq('chatroomId', chatroomId).eq('role', 'reviewer')
          )
          .unique();
        await ctx.db.patch(reviewer!._id, { lastSeenAction: 'exited' });
      });

      const result = await t.run(async (ctx) => {
        return areAllAgentsWaiting(ctx, chatroomId);
      });
      expect(result).toBe(true);
    });

    test('exited participant is excluded from highest priority waiting role', async () => {
      const { sessionId } = await createTestSession('test-exited-priority');
      const chatroomId = await createPairTeamChatroom(sessionId);

      await joinParticipant(sessionId, chatroomId, 'builder');
      await joinParticipant(sessionId, chatroomId, 'reviewer');

      await t.run(async (ctx) => {
        const builder = await ctx.db
          .query('chatroom_participants')
          .withIndex('by_chatroom_and_role', (q) =>
            q.eq('chatroomId', chatroomId).eq('role', 'builder')
          )
          .unique();
        await ctx.db.patch(builder!._id, { lastSeenAction: 'exited' });

        const reviewer = await ctx.db
          .query('chatroom_participants')
          .withIndex('by_chatroom_and_role', (q) =>
            q.eq('chatroomId', chatroomId).eq('role', 'reviewer')
          )
          .unique();
        await ctx.db.patch(reviewer!._id, { lastSeenAction: 'get-next-task:started' });
      });

      await t.run(async (ctx) => {
        const participants = await ctx.db
          .query('chatroom_participants')
          .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
          .collect();

        const activeWaiting = participants
          .filter(isActiveParticipant)
          .filter((p) => p.lastSeenAction === 'get-next-task:started');

        expect(activeWaiting.every((p) => p.role !== 'builder')).toBe(true);
        expect(activeWaiting.some((p) => p.role === 'reviewer')).toBe(true);
      });
    });
  });
});

describe('queue promotion guard includes acknowledged tasks', () => {
  test('acknowledged task blocks queue promotion when entry point joins with get-next-task:started', async () => {
    const { sessionId } = await createTestSession('test-acknowledged-blocks-promo');
    const chatroomId = await createPairTeamChatroom(sessionId);

    // Create an acknowledged task (entry point builder has claimed it but not started yet)
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert('chatroom_tasks', {
        chatroomId,
        createdBy: 'user',
        content: 'acknowledged task content',
        status: 'acknowledged',
        createdAt: now,
        updatedAt: now,
        queuePosition: 0,
        assignedTo: 'builder',
      });
    });

    // Create a queue record (user sent another message while builder has an acknowledged task)
    let queuedMessageId: string | undefined;
    await t.run(async (ctx) => {
      queuedMessageId = (await ctx.db.insert('chatroom_messageQueue', {
        chatroomId,
        senderRole: 'user',
        targetRole: 'builder',
        content: 'second queued message',
        type: 'message',
        queuePosition: 1,
      })) as unknown as string;
    });

    // Builder (entry point) joins with get-next-task:started — this simulates crash recovery
    // or re-registration. The acknowledged task must block queue promotion.
    await t.mutation(require('../../convex/_generated/api').api.participants.join, {
      sessionId,
      chatroomId,
      role: 'builder',
      action: 'get-next-task:started',
    });

    // Verify the queue record was NOT consumed
    await t.run(async (ctx) => {
      const queueRecord = await ctx.db.get('chatroom_messageQueue', queuedMessageId as any);
      expect(queueRecord).not.toBeNull();

      // No additional pending task should have been created
      const tasks = await ctx.db
        .query('chatroom_tasks')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .collect();
      const pendingTasks = tasks.filter((t) => t.status === 'pending');
      expect(pendingTasks.length).toBe(0);
    });
  });
});
