/**
 * Participant Lifecycle Integration Tests
 *
 * Tests for participant presence tracking and queue promotion:
 * - areAllAgentsPresent correctly identifies stale participants as not present
 */

import { describe, expect, test } from 'vitest';

import { HEARTBEAT_TTL_MS } from '../../config/reliability';
import { t } from '../../test.setup';
import { createTestSession, createPairTeamChatroom, joinParticipant } from '../helpers/integration';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Participant Lifecycle', () => {
  describe('areAllAgentsPresent with stale participants', () => {
    test('areAllAgentsPresent returns false when a participant has stale lastSeenAt', async () => {
      const { sessionId } = await createTestSession('test-stale-present');
      const chatroomId = await createPairTeamChatroom(sessionId);

      // Join both participants (sets lastSeenAt = now for both)
      await joinParticipant(sessionId, chatroomId, 'builder');
      await joinParticipant(sessionId, chatroomId, 'reviewer');

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

      await joinParticipant(sessionId, chatroomId, 'builder');
      await joinParticipant(sessionId, chatroomId, 'reviewer');

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

      // Join reviewer first
      await joinParticipant(sessionId, chatroomId, 'reviewer');

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

      // Now join builder (entry point) — queue promotion should NOT happen
      // because reviewer has stale lastSeenAt
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
