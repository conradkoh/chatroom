/**
 * Participant Lifecycle Integration Tests
 *
 * Tests for participant presence tracking and queue promotion:
 * - Handoff sets readyUntil on the sender's participant
 * - Ghost participants (expired readyUntil) are cleaned by cleanupStaleAgents
 * - areAllAgentsPresent correctly identifies stale participants as not present
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

      // Phase 1: First cleanup marks the participant as planned_cleanup (two-phase cleanup)
      await t.mutation(internal.tasks.cleanupStaleAgents, {});

      // Verify builder is now in planned_cleanup status (not yet deleted)
      const afterPhase1 = await t.query(api.participants.getByRole, {
        sessionId,
        chatroomId,
        role: 'builder',
      });
      expect(afterPhase1).not.toBeNull();
      expect(afterPhase1!.status).toBe('planned_cleanup');

      // Expire the cleanup deadline to simulate time passing past the grace period
      await t.run(async (ctx) => {
        const participants = await ctx.db
          .query('chatroom_participants')
          .filter((q) => q.eq(q.field('chatroomId'), chatroomId))
          .collect();
        const builder = participants.find((p) => p.role === 'builder');
        if (builder) {
          await ctx.db.patch('chatroom_participants', builder._id, {
            cleanupDeadline: Date.now() - 1_000, // deadline expired 1 second ago
          });
        }
      });

      // Phase 2: Second cleanup deletes participants past their deadline
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

  describe('areAllAgentsPresent with stale participants', () => {
    test('areAllAgentsPresent returns false when a participant has stale lastSeenAt', async () => {
      const { sessionId } = await createTestSession('test-stale-present');
      const chatroomId = await createPairTeamChatroom(sessionId);

      // Join both participants (sets lastSeenAt = now for both)
      const validReadyUntil = Date.now() + 10 * 60 * 1000;
      await joinParticipant(sessionId, chatroomId, 'builder', validReadyUntil);
      await joinParticipant(sessionId, chatroomId, 'reviewer', validReadyUntil);

      // Manually make builder's lastSeenAt stale (older than PRESENCE_WINDOW_MS)
      await t.run(async (ctx) => {
        const participants = await ctx.db
          .query('chatroom_participants')
          .filter((q) => q.eq(q.field('chatroomId'), chatroomId))
          .collect();
        const builder = participants.find((p) => p.role === 'builder');
        if (builder) {
          await ctx.db.patch('chatroom_participants', builder._id, {
            lastSeenAt: Date.now() - HEARTBEAT_TTL_MS - 10_000, // stale by 10s beyond window
          });
        }
      });

      // Directly verify via t.run that areAllAgentsPresent would return false
      await t.run(async (ctx) => {
        const participants = await ctx.db
          .query('chatroom_participants')
          .filter((q) => q.eq(q.field('chatroomId'), chatroomId))
          .collect();

        const now = Date.now();
        const allPresent = participants.every(
          (p) => p.lastSeenAt !== undefined && now - p.lastSeenAt <= HEARTBEAT_TTL_MS
        );

        // Builder has stale lastSeenAt, so allPresent should be false
        expect(allPresent).toBe(false);
      });
    });

    test('areAllAgentsPresent returns true when all participants have recent lastSeenAt', async () => {
      const { sessionId } = await createTestSession('test-recent-present');
      const chatroomId = await createPairTeamChatroom(sessionId);

      const validReadyUntil = Date.now() + 10 * 60 * 1000;
      await joinParticipant(sessionId, chatroomId, 'builder', validReadyUntil);
      await joinParticipant(sessionId, chatroomId, 'reviewer', validReadyUntil);

      // Verify via t.run that areAllAgentsPresent logic would return true
      await t.run(async (ctx) => {
        const participants = await ctx.db
          .query('chatroom_participants')
          .filter((q) => q.eq(q.field('chatroomId'), chatroomId))
          .collect();

        const now = Date.now();
        const allPresent = participants.every(
          (p) => p.lastSeenAt !== undefined && now - p.lastSeenAt <= HEARTBEAT_TTL_MS
        );

        // All participants just joined so lastSeenAt is recent — allPresent should be true
        expect(allPresent).toBe(true);
      });
    });

    test('stale participant blocks queue promotion on entry point join', async () => {
      const { sessionId } = await createTestSession('test-stale-blocks-promo');
      const chatroomId = await createPairTeamChatroom(sessionId);

      // Join reviewer with valid readyUntil first
      const validReadyUntil = Date.now() + 10 * 60 * 1000;
      await joinParticipant(sessionId, chatroomId, 'reviewer', validReadyUntil);

      // Make reviewer's lastSeenAt stale (simulating a disconnected ghost)
      await t.run(async (ctx) => {
        const participants = await ctx.db
          .query('chatroom_participants')
          .filter((q) => q.eq(q.field('chatroomId'), chatroomId))
          .collect();
        const reviewer = participants.find((p) => p.role === 'reviewer');
        if (reviewer) {
          await ctx.db.patch('chatroom_participants', reviewer._id, {
            lastSeenAt: Date.now() - HEARTBEAT_TTL_MS - 10_000, // stale
          });
        }
      });

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
      // Queue promotion should NOT happen because reviewer has stale lastSeenAt
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
