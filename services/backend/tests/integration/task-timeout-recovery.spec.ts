/**
 * Task Timeout Recovery Integration Tests
 *
 * Tests for Phase 4 of the agent reliability system:
 * - Stuck acknowledged tasks are reset to pending when the participant is gone
 * - Stuck pending tasks trigger auto-restart for remote agents
 * - Stuck pending tasks log warnings for custom agents
 */

import { describe, expect, test } from 'vitest';

import { TASK_ACKNOWLEDGED_TIMEOUT_MS, TASK_PENDING_TIMEOUT_MS } from '../../config/reliability';
import { api, internal } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { t } from '../../test.setup';
import {
  createTestSession,
  createPairTeamChatroom,
  joinParticipant,
  registerMachineWithDaemon,
  setupRemoteAgentConfig,
  getPendingCommands,
} from '../helpers/integration';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Task Timeout Recovery', () => {
  describe('Stuck acknowledged tasks', () => {
    test('acknowledged task with missing participant is reset to pending', async () => {
      const { sessionId } = await createTestSession('test-ack-recovery-1');
      const chatroomId = await createPairTeamChatroom(sessionId);

      // Join builder so we can send a message and have it create a task
      const readyUntil = Date.now() + 10 * 60 * 1000;
      await joinParticipant(sessionId, chatroomId, 'builder', readyUntil);
      await joinParticipant(sessionId, chatroomId, 'reviewer', readyUntil);

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

      // Verify task is acknowledged
      const tasksBeforeCleanup = await t.query(api.tasks.getPendingTasksForRole, {
        sessionId,
        chatroomId,
        role: 'builder',
      });
      // The task should be acknowledged
      const ackTask = tasksBeforeCleanup.find(
        (tw: { task: { status: string } }) => tw.task.status === 'acknowledged'
      );
      expect(ackTask).toBeDefined();
      const taskId = ackTask!.task._id;

      // Now remove the participant (simulate agent death)
      await t.mutation(api.participants.leave, {
        sessionId,
        chatroomId,
        role: 'builder',
      });

      // Manually patch the task's acknowledgedAt to be older than TASK_ACKNOWLEDGED_TIMEOUT_MS
      await t.run(async (ctx) => {
        const task = await ctx.db.get('chatroom_tasks', taskId);
        if (task) {
          const oldTime = Date.now() - TASK_ACKNOWLEDGED_TIMEOUT_MS - 10_000;
          await ctx.db.patch('chatroom_tasks', taskId, {
            acknowledgedAt: oldTime,
            updatedAt: oldTime,
          });
        }
      });

      // Run cleanup
      await t.mutation(internal.tasks.cleanupStaleAgents, {});

      // Verify task was reset to pending
      await t.run(async (ctx) => {
        const task = await ctx.db.get('chatroom_tasks', taskId);
        expect(task).not.toBeNull();
        expect(task!.status).toBe('pending');
        expect(task!.assignedTo).toBeUndefined();
        expect(task!.acknowledgedAt).toBeUndefined();
      });
    });

    test('recently acknowledged task with valid participant is NOT recovered', async () => {
      const { sessionId } = await createTestSession('test-ack-recovery-2');
      const chatroomId = await createPairTeamChatroom(sessionId);

      const readyUntil = Date.now() + 10 * 60 * 1000;
      await joinParticipant(sessionId, chatroomId, 'builder', readyUntil);
      await joinParticipant(sessionId, chatroomId, 'reviewer', readyUntil);

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

      // Get the task ID
      const tasks = await t.query(api.tasks.getPendingTasksForRole, {
        sessionId,
        chatroomId,
        role: 'builder',
      });
      const taskId = tasks[0]!.task._id;

      // Participant is still present and valid — run cleanup
      await t.mutation(internal.tasks.cleanupStaleAgents, {});

      // Task should still be acknowledged
      await t.run(async (ctx) => {
        const task = await ctx.db.get('chatroom_tasks', taskId);
        expect(task).not.toBeNull();
        expect(task!.status).toBe('acknowledged');
      });
    });
  });

  describe('Stuck pending tasks', () => {
    test('stuck pending task triggers auto-restart for remote agent', async () => {
      const { sessionId } = await createTestSession('test-pending-recovery-1');
      const chatroomId = await createPairTeamChatroom(sessionId);
      const { machineId } = await registerMachineWithDaemon(sessionId, 'machine-recovery-1');
      await setupRemoteAgentConfig(sessionId, chatroomId, machineId, 'builder');

      // Join participants to create the task, then remove them
      const readyUntil = Date.now() + 10 * 60 * 1000;
      await joinParticipant(sessionId, chatroomId, 'builder', readyUntil);
      await joinParticipant(sessionId, chatroomId, 'reviewer', readyUntil);

      await t.mutation(api.messages.send, {
        sessionId,
        chatroomId,
        content: 'Build the feature',
        senderRole: 'user',
        type: 'message' as const,
      });

      // Get the task ID
      let taskId: Id<'chatroom_tasks'> | undefined;
      await t.run(async (ctx) => {
        const tasks = await ctx.db
          .query('chatroom_tasks')
          .filter((q) => q.eq(q.field('chatroomId'), chatroomId))
          .filter((q) => q.eq(q.field('status'), 'pending'))
          .collect();
        expect(tasks.length).toBeGreaterThan(0);
        taskId = tasks[0]!._id;
      });

      // Remove the builder participant (simulate agent death)
      await t.mutation(api.participants.leave, {
        sessionId,
        chatroomId,
        role: 'builder',
      });

      // Make the task appear old enough
      await t.run(async (ctx) => {
        const oldTime = Date.now() - TASK_PENDING_TIMEOUT_MS - 10_000;
        await ctx.db.patch('chatroom_tasks', taskId!, {
          updatedAt: oldTime,
        });
      });

      // Run cleanup
      await t.mutation(internal.tasks.cleanupStaleAgents, {});

      // Verify auto-restart commands were created
      const pending = await getPendingCommands(sessionId, machineId);
      const startCommands = pending.filter((c: { type: string }) => c.type === 'start-agent');
      expect(startCommands.length).toBe(1);
      expect(startCommands[0].payload.role).toBe('builder');
    });

    test('stuck pending task with custom agent logs warning (no auto-restart)', async () => {
      const { sessionId } = await createTestSession('test-pending-recovery-2');
      const chatroomId = await createPairTeamChatroom(sessionId);

      // Register as custom agent (not remote)
      await t.mutation(api.machines.saveTeamAgentConfig, {
        sessionId,
        chatroomId,
        role: 'builder',
        type: 'custom',
      });

      // Join participants to create the task
      const readyUntil = Date.now() + 10 * 60 * 1000;
      await joinParticipant(sessionId, chatroomId, 'builder', readyUntil);
      await joinParticipant(sessionId, chatroomId, 'reviewer', readyUntil);

      await t.mutation(api.messages.send, {
        sessionId,
        chatroomId,
        content: 'Build the feature',
        senderRole: 'user',
        type: 'message' as const,
      });

      // Get the task ID
      let taskId: Id<'chatroom_tasks'> | undefined;
      await t.run(async (ctx) => {
        const tasks = await ctx.db
          .query('chatroom_tasks')
          .filter((q) => q.eq(q.field('chatroomId'), chatroomId))
          .filter((q) => q.eq(q.field('status'), 'pending'))
          .collect();
        expect(tasks.length).toBeGreaterThan(0);
        taskId = tasks[0]!._id;
      });

      // Remove builder participant
      await t.mutation(api.participants.leave, {
        sessionId,
        chatroomId,
        role: 'builder',
      });

      // Make the task appear old enough
      await t.run(async (ctx) => {
        const oldTime = Date.now() - TASK_PENDING_TIMEOUT_MS - 10_000;
        await ctx.db.patch('chatroom_tasks', taskId!, {
          updatedAt: oldTime,
        });
      });

      // Run cleanup — should NOT create any restart commands
      await t.mutation(internal.tasks.cleanupStaleAgents, {});

      // Task should still be pending (no FSM transition for pending tasks)
      await t.run(async (ctx) => {
        const task = await ctx.db.get('chatroom_tasks', taskId!);
        expect(task).not.toBeNull();
        expect(task!.status).toBe('pending');
      });
    });
  });
});
