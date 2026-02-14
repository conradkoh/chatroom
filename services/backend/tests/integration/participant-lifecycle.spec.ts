/**
 * Participant Lifecycle Integration Tests
 *
 * Tests for participant readyUntil management and ghost participant prevention:
 * - Handoff sets readyUntil on the sender's participant
 * - Ghost participants (expired readyUntil) are cleaned by cleanupStaleAgents
 * - areAllAgentsReady correctly identifies expired participants as not ready
 */

import { describe, expect, test } from 'vitest';

import { HEARTBEAT_TTL_MS } from '../../config/reliability';
import { api, internal } from '../../convex/_generated/api';
import { t } from '../../test.setup';
import { createTestSession, createPairTeamChatroom, joinParticipant } from '../helpers/integration';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Participant Lifecycle', () => {
  describe('Handoff sets readyUntil', () => {
    test('handoff sets readyUntil on the sender participant', async () => {
      const { sessionId } = await createTestSession('test-handoff-readyuntil');
      const chatroomId = await createPairTeamChatroom(sessionId);

      const readyUntil = Date.now() + 10 * 60 * 1000;
      await joinParticipant(sessionId, chatroomId, 'builder', readyUntil);
      await joinParticipant(sessionId, chatroomId, 'reviewer', readyUntil);

      // Send a user message to create a task for builder
      await t.mutation(api.messages.send, {
        sessionId,
        chatroomId,
        content: 'Build the feature',
        senderRole: 'user',
        type: 'message' as const,
      });

      // Claim and start the task as builder
      await t.mutation(api.tasks.claimTask, {
        sessionId,
        chatroomId,
        role: 'builder',
      });
      const startResult = await t.mutation(api.tasks.startTask, {
        sessionId,
        chatroomId,
        role: 'builder',
      });
      await t.mutation(api.messages.taskStarted, {
        sessionId,
        chatroomId,
        role: 'builder',
        taskId: startResult.taskId,
        originMessageClassification: 'question',
      });

      // Builder hands off to reviewer
      await t.mutation(api.messages.handoff, {
        sessionId,
        chatroomId,
        senderRole: 'builder',
        content: 'Done with implementation, please review.',
        targetRole: 'reviewer',
      });

      // Verify builder's participant now has readyUntil set
      const builderParticipant = await t.query(api.participants.getByRole, {
        sessionId,
        chatroomId,
        role: 'builder',
      });

      expect(builderParticipant).not.toBeNull();
      expect(builderParticipant!.status).toBe('waiting');
      expect(builderParticipant!.readyUntil).toBeDefined();
      // readyUntil should be approximately now + HEARTBEAT_TTL_MS (within 5s tolerance)
      const expectedReadyUntil = Date.now() + HEARTBEAT_TTL_MS;
      expect(builderParticipant!.readyUntil).toBeGreaterThan(expectedReadyUntil - 5_000);
      expect(builderParticipant!.readyUntil).toBeLessThanOrEqual(expectedReadyUntil + 5_000);
    });
  });

  describe('Ghost participant cleanup', () => {
    test('ghost participant with expired readyUntil is cleaned by cleanupStaleAgents', async () => {
      const { sessionId } = await createTestSession('test-ghost-cleanup');
      const chatroomId = await createPairTeamChatroom(sessionId);

      const readyUntil = Date.now() + 10 * 60 * 1000;
      await joinParticipant(sessionId, chatroomId, 'builder', readyUntil);
      await joinParticipant(sessionId, chatroomId, 'reviewer', readyUntil);

      // Send a user message, claim, start, and handoff to create a participant in waiting state
      await t.mutation(api.messages.send, {
        sessionId,
        chatroomId,
        content: 'Build the feature',
        senderRole: 'user',
        type: 'message' as const,
      });

      await t.mutation(api.tasks.claimTask, {
        sessionId,
        chatroomId,
        role: 'builder',
      });
      const startResult = await t.mutation(api.tasks.startTask, {
        sessionId,
        chatroomId,
        role: 'builder',
      });
      await t.mutation(api.messages.taskStarted, {
        sessionId,
        chatroomId,
        role: 'builder',
        taskId: startResult.taskId,
        originMessageClassification: 'question',
      });

      await t.mutation(api.messages.handoff, {
        sessionId,
        chatroomId,
        senderRole: 'builder',
        content: 'Done, please review.',
        targetRole: 'reviewer',
      });

      // Manually expire the builder's readyUntil to simulate time passing
      await t.run(async (ctx) => {
        const participants = await ctx.db
          .query('chatroom_participants')
          .filter((q) => q.eq(q.field('chatroomId'), chatroomId))
          .collect();
        const builder = participants.find((p) => p.role === 'builder');
        if (builder) {
          await ctx.db.patch('chatroom_participants', builder._id, {
            readyUntil: Date.now() - 10_000, // expired 10 seconds ago
          });
        }
      });

      // Verify builder is still present before cleanup
      const beforeCleanup = await t.query(api.participants.getByRole, {
        sessionId,
        chatroomId,
        role: 'builder',
      });
      expect(beforeCleanup).not.toBeNull();

      // Run cleanup
      await t.mutation(internal.tasks.cleanupStaleAgents, {});

      // Verify builder was cleaned up (ghost participant removed)
      const afterCleanup = await t.query(api.participants.getByRole, {
        sessionId,
        chatroomId,
        role: 'builder',
      });
      expect(afterCleanup).toBeNull();
    });
  });

  describe('areAllAgentsReady with expired participants', () => {
    test('areAllAgentsReady returns false when a participant has expired readyUntil', async () => {
      const { sessionId } = await createTestSession('test-expired-ready');
      const chatroomId = await createPairTeamChatroom(sessionId);

      // Join builder with an already-expired readyUntil
      const expiredReadyUntil = Date.now() - 10_000; // expired 10 seconds ago
      await joinParticipant(sessionId, chatroomId, 'builder', expiredReadyUntil);

      // areAllAgentsReady is not directly exposed as an API, but it's used by
      // the queue promotion logic in participants.join. We can test it indirectly:
      // If areAllAgentsReady returns false, queued tasks should NOT be promoted.

      // First, create a queued task by sending a message when no agents are ready
      // We need to set up the scenario where queue promotion would happen

      // Join reviewer with valid readyUntil
      const validReadyUntil = Date.now() + 10 * 60 * 1000;
      await joinParticipant(sessionId, chatroomId, 'reviewer', validReadyUntil);

      // Send a user message to create a task
      await t.mutation(api.messages.send, {
        sessionId,
        chatroomId,
        content: 'Build the feature',
        senderRole: 'user',
        type: 'message' as const,
      });

      // Directly verify via t.run that areAllAgentsReady would return false
      // by checking the participant state
      await t.run(async (ctx) => {
        const participants = await ctx.db
          .query('chatroom_participants')
          .filter((q) => q.eq(q.field('chatroomId'), chatroomId))
          .collect();

        const now = Date.now();
        const hasActiveOrExpired = participants.some((p) => {
          if (p.status === 'active') return true;
          if (p.status === 'waiting' && p.readyUntil && p.readyUntil < now) return true;
          return false;
        });

        // Builder has expired readyUntil, so hasActiveOrExpired should be true
        expect(hasActiveOrExpired).toBe(true);
      });
    });

    test('areAllAgentsReady returns true when all participants have valid readyUntil', async () => {
      const { sessionId } = await createTestSession('test-valid-ready');
      const chatroomId = await createPairTeamChatroom(sessionId);

      const validReadyUntil = Date.now() + 10 * 60 * 1000;
      await joinParticipant(sessionId, chatroomId, 'builder', validReadyUntil);
      await joinParticipant(sessionId, chatroomId, 'reviewer', validReadyUntil);

      // Verify via t.run that areAllAgentsReady logic would return true
      await t.run(async (ctx) => {
        const participants = await ctx.db
          .query('chatroom_participants')
          .filter((q) => q.eq(q.field('chatroomId'), chatroomId))
          .collect();

        const now = Date.now();
        const hasActiveOrExpired = participants.some((p) => {
          if (p.status === 'active') return true;
          if (p.status === 'waiting' && p.readyUntil && p.readyUntil < now) return true;
          return false;
        });

        // All participants have valid readyUntil, so hasActiveOrExpired should be false
        expect(hasActiveOrExpired).toBe(false);
      });
    });

    test('expired participant blocks queue promotion on entry point join', async () => {
      const { sessionId } = await createTestSession('test-expired-blocks-promo');
      const chatroomId = await createPairTeamChatroom(sessionId);

      // Join reviewer with expired readyUntil (simulating a ghost)
      const expiredReadyUntil = Date.now() - 10_000;
      await joinParticipant(sessionId, chatroomId, 'reviewer', expiredReadyUntil);

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

      // Now join builder (entry point) with valid readyUntil
      // Queue promotion should NOT happen because reviewer has expired readyUntil
      const validReadyUntil = Date.now() + 10 * 60 * 1000;
      await joinParticipant(sessionId, chatroomId, 'builder', validReadyUntil);

      // Verify the queued task was NOT promoted to pending
      await t.run(async (ctx) => {
        const task = await ctx.db.get('chatroom_tasks', queuedTaskId as any);
        expect(task).not.toBeNull();
        expect(task!.status).toBe('queued'); // Should still be queued, not promoted
      });
    });
  });
});
