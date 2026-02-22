/**
 * Task Timeout Recovery Integration Tests
 *
 * Tests for the agent reliability system:
 * - Stuck acknowledged tasks are reset to pending when the participant is gone
 */

import { describe, expect, test } from 'vitest';

import { TASK_ACKNOWLEDGED_TIMEOUT_MS } from '../../config/reliability';
import { api, internal } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { t } from '../../test.setup';
import { createTestSession, createPairTeamChatroom, joinParticipant } from '../helpers/integration';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Task Timeout Recovery', () => {
  describe('Stuck acknowledged tasks', () => {
    test('acknowledged task with missing participant is reset to pending', async () => {
      const { sessionId } = await createTestSession('test-ack-recovery-1');
      const chatroomId = await createPairTeamChatroom(sessionId);

      // Join builder so we can send a message and have it create a task
      await joinParticipant(sessionId, chatroomId, 'builder');
      await joinParticipant(sessionId, chatroomId, 'reviewer');

      // Send a message to create a task
      await t.mutation(api.messages.send, {
        sessionId,
        chatroomId,
        content: 'Build the feature',
        senderRole: 'user',
        type: 'message' as const,
      });

      // Claim the task (pending → acknowledged)
      await t.mutation(api.tasks.claimTask, {
        sessionId,
        chatroomId,
        role: 'builder',
      });

      // Verify task is acknowledged (recently acknowledged → grace_period response)
      const tasksBeforeCleanup = await t.query(api.tasks.getPendingTasksForRole, {
        sessionId,
        chatroomId,
        role: 'builder',
      });
      expect(tasksBeforeCleanup.type).toBe('grace_period');
      const taskId = (tasksBeforeCleanup as { type: 'grace_period'; taskId: string })
        .taskId as Id<'chatroom_tasks'>;

      // Now remove the participant (simulate agent death)
      await t.mutation(api.participants.leave, {
        sessionId,
        chatroomId,
        role: 'builder',
      });

      // Manually patch the task's acknowledgedAt to be older than TASK_ACKNOWLEDGED_TIMEOUT_MS
      await t.run(async (ctx) => {
        const task = await ctx.db.get(taskId);
        if (task) {
          const oldTime = Date.now() - TASK_ACKNOWLEDGED_TIMEOUT_MS - 10_000;
          await ctx.db.patch(taskId, {
            acknowledgedAt: oldTime,
            updatedAt: oldTime,
          });
        }
      });

      // Run cleanup
      await t.mutation(internal.tasks.cleanupStaleAgents, {});

      // Verify task was reset to pending
      await t.run(async (ctx) => {
        const task = await ctx.db.get(taskId);
        expect(task).not.toBeNull();
        expect(task!.status).toBe('pending');
        expect(task!.assignedTo).toBeUndefined();
        expect(task!.acknowledgedAt).toBeUndefined();
      });
    });

    test('recently acknowledged task with valid participant is NOT recovered', async () => {
      const { sessionId } = await createTestSession('test-ack-recovery-2');
      const chatroomId = await createPairTeamChatroom(sessionId);

      await joinParticipant(sessionId, chatroomId, 'builder');
      await joinParticipant(sessionId, chatroomId, 'reviewer');

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

      // Get the task ID (recently acknowledged → grace_period response)
      const tasksResult = await t.query(api.tasks.getPendingTasksForRole, {
        sessionId,
        chatroomId,
        role: 'builder',
      });
      expect(tasksResult.type).toBe('grace_period');
      const taskId = (tasksResult as { type: 'grace_period'; taskId: string })
        .taskId as Id<'chatroom_tasks'>;

      // Participant is still present and valid — run cleanup
      await t.mutation(internal.tasks.cleanupStaleAgents, {});

      // Task should still be acknowledged
      await t.run(async (ctx) => {
        const task = await ctx.db.get(taskId);
        expect(task).not.toBeNull();
        expect(task!.status).toBe('acknowledged');
      });
    });
  });
});
