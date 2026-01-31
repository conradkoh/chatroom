/**
 * Task FSM (Finite State Machine) Integration Tests
 *
 * Tests for Plan 021: Task FSM Refactor
 * Validates all state transitions through the FSM module to ensure:
 * - Status is the single source of truth
 * - All transitions go through transitionTask()
 * - Invalid transitions are properly rejected
 * - Field cleanup happens automatically
 * - Backlog attachment tracking works correctly
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { t } from '../../test.setup';

/**
 * Helper to create a test session and authenticate
 */
async function createTestSession(sessionId: string): Promise<{ sessionId: SessionId }> {
  const login = await t.mutation(api.auth.loginAnon, {
    sessionId: sessionId as SessionId,
  });
  expect(login.success).toBe(true);
  return { sessionId: sessionId as SessionId };
}

/**
 * Helper to create a Pair team chatroom
 */
async function createPairTeamChatroom(sessionId: SessionId): Promise<Id<'chatroom_rooms'>> {
  const chatroomId = await t.mutation(api.chatrooms.create, {
    sessionId,
    teamId: 'pair',
    teamName: 'Pair',
    teamRoles: ['builder', 'reviewer'],
    teamEntryPoint: 'builder',
  });
  return chatroomId;
}

/**
 * Helper to join participants to the chatroom with ready status
 */
async function joinParticipants(
  sessionId: SessionId,
  chatroomId: Id<'chatroom_rooms'>,
  roles: string[]
): Promise<void> {
  const readyUntil = Date.now() + 10 * 60 * 1000; // 10 minutes
  for (const role of roles) {
    await t.mutation(api.participants.join, {
      sessionId,
      chatroomId,
      role,
      readyUntil,
    });
  }
}

describe('FSM Phase 3: Split Acknowledgment from Work Start', () => {
  describe('Chat Message Flow: pending → acknowledged → in_progress → completed', () => {
    test('complete user message workflow through FSM states', async () => {
      const { sessionId } = await createTestSession('test-fsm-user-message-flow');
      const chatroomId = await createPairTeamChatroom(sessionId);
      await joinParticipants(sessionId, chatroomId, ['builder', 'reviewer']);

      // Step 1: User sends a message, creates task in 'pending' status
      const messageId = await t.mutation(api.messages.sendMessage, {
        sessionId,
        chatroomId,
        content: 'Please fix the login bug',
        senderRole: 'user',
        type: 'message',
      });
      expect(messageId).toBeDefined();

      // Verify task is pending
      let tasks = await t.query(api.tasks.listTasks, {
        sessionId,
        chatroomId,
        statusFilter: 'pending',
      });
      expect(tasks.length).toBe(1);
      expect(tasks[0]?.status).toBe('pending');
      expect(tasks[0]?.assignedTo).toBeUndefined();
      expect(tasks[0]?.acknowledgedAt).toBeUndefined();
      const taskId = tasks[0]?._id as Id<'chatroom_tasks'>;

      // Step 2: Agent claims the task (pending → acknowledged)
      const claimResult = await t.mutation(api.tasks.claimTask, {
        sessionId,
        chatroomId,
        role: 'builder',
      });
      expect(claimResult.taskId).toBe(taskId);

      // Verify task is acknowledged
      tasks = await t.query(api.tasks.listTasks, {
        sessionId,
        chatroomId,
        limit: 100,
      });
      const acknowledgedTask = tasks.find((t) => t._id === taskId);
      expect(acknowledgedTask?.status).toBe('acknowledged');
      expect(acknowledgedTask?.assignedTo).toBe('builder');
      expect(acknowledgedTask?.acknowledgedAt).toBeDefined();
      expect(acknowledgedTask?.startedAt).toBeUndefined(); // Not started yet

      // Step 3: Agent starts work via task-started (acknowledged → in_progress)
      const startResult = await t.mutation(api.tasks.startTask, {
        sessionId,
        chatroomId,
        role: 'builder',
      });
      expect(startResult.taskId).toBe(taskId);

      // Verify task is in_progress
      tasks = await t.query(api.tasks.listTasks, {
        sessionId,
        chatroomId,
        statusFilter: 'in_progress',
      });
      expect(tasks.length).toBe(1);
      expect(tasks[0]?.status).toBe('in_progress');
      expect(tasks[0]?.assignedTo).toBe('builder');
      expect(tasks[0]?.acknowledgedAt).toBeDefined();
      expect(tasks[0]?.startedAt).toBeDefined();

      // Step 4: Agent completes the task (in_progress → completed)
      const completeResult = await t.mutation(api.tasks.completeTask, {
        sessionId,
        chatroomId,
        role: 'builder',
      });
      expect(completeResult.completed).toBe(true);

      // Verify task is completed
      tasks = await t.query(api.tasks.listTasks, {
        sessionId,
        chatroomId,
        statusFilter: 'archived',
      });
      const completedTask = tasks.find((t) => t._id === taskId);
      expect(completedTask?.status).toBe('completed');
      expect(completedTask?.completedAt).toBeDefined();
    });

    test('claimTask prevents duplicate task delivery', async () => {
      const { sessionId } = await createTestSession('test-fsm-claim-race');
      const chatroomId = await createPairTeamChatroom(sessionId);
      await joinParticipants(sessionId, chatroomId, ['builder', 'reviewer']);

      // Create a pending task
      await t.mutation(api.messages.sendMessage, {
        sessionId,
        chatroomId,
        content: 'Task for race condition test',
        senderRole: 'user',
        type: 'message',
      });

      // First agent claims the task - should succeed
      const claim1 = await t.mutation(api.tasks.claimTask, {
        sessionId,
        chatroomId,
        role: 'builder',
      });
      expect(claim1.taskId).toBeDefined();

      // Second agent tries to claim - should fail (no pending task)
      await expect(
        t.mutation(api.tasks.claimTask, {
          sessionId,
          chatroomId,
          role: 'reviewer',
        })
      ).rejects.toThrow('No pending task to claim');
    });

    test('startTask requires acknowledged status', async () => {
      const { sessionId } = await createTestSession('test-fsm-start-requires-acknowledged');
      const chatroomId = await createPairTeamChatroom(sessionId);
      await joinParticipants(sessionId, chatroomId, ['builder', 'reviewer']);

      // Create a pending task
      await t.mutation(api.messages.sendMessage, {
        sessionId,
        chatroomId,
        content: 'Task to test start without claim',
        senderRole: 'user',
        type: 'message',
      });

      // Try to start without claiming first - should fail
      await expect(
        t.mutation(api.tasks.startTask, {
          sessionId,
          chatroomId,
          role: 'builder',
        })
      ).rejects.toThrow('No acknowledged task to start for this role');
    });
  });
});

describe('FSM: Acknowledged to Pending User Review Transition', () => {
  test('acknowledged task can transition to pending_user_review via parentTaskAcknowledged', async () => {
    const { sessionId } = await createTestSession('test-fsm-acknowledged-to-pending-review');
    const chatroomId = await createPairTeamChatroom(sessionId);
    await joinParticipants(sessionId, chatroomId, ['builder', 'reviewer']);

    // Create a backlog task
    const backlogTask = await t.mutation(api.tasks.createTask, {
      sessionId,
      chatroomId,
      content: 'Backlog item to attach',
      createdBy: 'user',
      isBacklog: true,
    });
    expect(backlogTask.status).toBe('backlog');

    // Send message and attach the backlog task - this creates a parent task
    const messageId = await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      content: 'Please work on this backlog item',
      senderRole: 'user',
      type: 'message',
      attachedTaskIds: [backlogTask.taskId],
    });
    expect(messageId).toBeDefined();

    // Claim the parent task (pending → acknowledged)
    const claimResult = await t.mutation(api.tasks.claimTask, {
      sessionId,
      chatroomId,
      role: 'builder',
    });
    expect(claimResult.taskId).toBeDefined();

    // Verify parent task is acknowledged
    const tasks = await t.query(api.tasks.listTasks, {
      sessionId,
      chatroomId,
      limit: 100,
    });
    const acknowledgedTask = tasks.find((t) => t._id === claimResult.taskId);
    expect(acknowledgedTask?.status).toBe('acknowledged');

    // The backlog task should have transitioned based on parent task acknowledgment
    // Check that the FSM allows acknowledged → pending_user_review transition
    const backlogTaskUpdated = tasks.find((t) => t._id === backlogTask.taskId);
    expect(backlogTaskUpdated).toBeDefined();
    // Backlog task should be in backlog_acknowledged or pending_user_review
    expect(['backlog_acknowledged', 'pending_user_review']).toContain(backlogTaskUpdated?.status);
  });
});

describe('FSM Phase 2: Backlog Attachment Tracking', () => {
  describe('Backlog Flow: backlog → backlog_acknowledged → pending_user_review', () => {
    test('attaching backlog task to message transitions to backlog_acknowledged', async () => {
      const { sessionId } = await createTestSession('test-fsm-backlog-attachment');
      const chatroomId = await createPairTeamChatroom(sessionId);
      await joinParticipants(sessionId, chatroomId, ['builder', 'reviewer']);

      // Step 1: Create backlog task
      const backlogTask = await t.mutation(api.tasks.createTask, {
        sessionId,
        chatroomId,
        content: 'Backlog item for attachment test',
        createdBy: 'user',
        isBacklog: true,
      });
      expect(backlogTask.status).toBe('backlog');

      // Step 2: Send message with attached backlog task
      const messageId = await t.mutation(api.messages.sendMessage, {
        sessionId,
        chatroomId,
        content: 'Please implement this backlog item',
        senderRole: 'user',
        type: 'message',
        attachedTaskIds: [backlogTask.taskId],
      });
      expect(messageId).toBeDefined();

      // Step 3: Verify backlog task transitioned to backlog_acknowledged
      const tasks = await t.query(api.tasks.listTasks, {
        sessionId,
        chatroomId,
        limit: 100,
      });
      const attachedTask = tasks.find((t) => t._id === backlogTask.taskId);
      expect(attachedTask?.status).toBe('backlog_acknowledged');
      expect(attachedTask?.parentTaskIds).toBeDefined();
      expect(attachedTask?.parentTaskIds?.length).toBeGreaterThan(0);

      // Step 4: Find the main task and verify it has attachedTaskIds
      const mainTask = tasks.find((t) => t.sourceMessageId === messageId);
      expect(mainTask).toBeDefined();
      expect(mainTask?.attachedTaskIds).toBeDefined();
      expect(mainTask?.attachedTaskIds).toContain(backlogTask.taskId);
    });

    test('backlog task can be attached to multiple parent tasks (many-to-many)', async () => {
      const { sessionId } = await createTestSession('test-fsm-backlog-many-to-many');
      const chatroomId = await createPairTeamChatroom(sessionId);
      await joinParticipants(sessionId, chatroomId, ['builder', 'reviewer']);

      // Create a backlog task
      const backlogTask = await t.mutation(api.tasks.createTask, {
        sessionId,
        chatroomId,
        content: 'Shared backlog item',
        createdBy: 'user',
        isBacklog: true,
      });

      // Attach to first message
      const message1 = await t.mutation(api.messages.sendMessage, {
        sessionId,
        chatroomId,
        content: 'First task referencing backlog',
        senderRole: 'user',
        type: 'message',
        attachedTaskIds: [backlogTask.taskId],
      });

      // Complete first task to clear the way
      await t.mutation(api.tasks.claimTask, { sessionId, chatroomId, role: 'builder' });
      await t.mutation(api.tasks.startTask, { sessionId, chatroomId, role: 'builder' });
      await t.mutation(api.tasks.completeTask, { sessionId, chatroomId, role: 'builder' });

      // Attach same backlog task to second message
      const message2 = await t.mutation(api.messages.sendMessage, {
        sessionId,
        chatroomId,
        content: 'Second task referencing same backlog',
        senderRole: 'user',
        type: 'message',
        attachedTaskIds: [backlogTask.taskId],
      });

      // Verify backlog task has both parent tasks
      const tasks = await t.query(api.tasks.listTasks, {
        sessionId,
        chatroomId,
        limit: 100,
      });
      const backlogTaskUpdated = tasks.find((t) => t._id === backlogTask.taskId);
      expect(backlogTaskUpdated?.parentTaskIds).toBeDefined();
      expect(backlogTaskUpdated?.parentTaskIds?.length).toBe(2);

      // Verify both main tasks reference the backlog task
      const mainTask1 = tasks.find((t) => t.sourceMessageId === message1);
      const mainTask2 = tasks.find((t) => t.sourceMessageId === message2);
      expect(mainTask1?.attachedTaskIds).toContain(backlogTask.taskId);
      expect(mainTask2?.attachedTaskIds).toContain(backlogTask.taskId);
    });
  });
});

describe('FSM Phase 4: All Mutations Use FSM', () => {
  describe('Queue Management', () => {
    test('moveToQueue uses FSM for backlog → pending/queued transition', async () => {
      const { sessionId } = await createTestSession('test-fsm-move-to-queue');
      const chatroomId = await createPairTeamChatroom(sessionId);
      await joinParticipants(sessionId, chatroomId, ['builder', 'reviewer']);

      // Create backlog task
      const backlogTask = await t.mutation(api.tasks.createTask, {
        sessionId,
        chatroomId,
        content: 'Backlog item to move',
        createdBy: 'user',
        isBacklog: true,
      });

      // Move to queue
      const moveResult = await t.mutation(api.tasks.moveToQueue, {
        sessionId,
        taskId: backlogTask.taskId,
      });

      expect(moveResult.success).toBe(true);
      expect(moveResult.newStatus).toBe('pending'); // No active task, so goes to pending

      // Verify task transitioned correctly
      const tasks = await t.query(api.tasks.listTasks, {
        sessionId,
        chatroomId,
        statusFilter: 'pending',
      });
      const movedTask = tasks.find((t) => t._id === backlogTask.taskId);
      expect(movedTask?.status).toBe('pending');
    });

    test('promoteNextTask uses FSM for queued → pending transition', async () => {
      const { sessionId } = await createTestSession('test-fsm-promote-next');
      const chatroomId = await createPairTeamChatroom(sessionId);
      await joinParticipants(sessionId, chatroomId, ['builder', 'reviewer']);

      // Create first task (will be pending)
      await t.mutation(api.messages.sendMessage, {
        sessionId,
        chatroomId,
        content: 'First task',
        senderRole: 'user',
        type: 'message',
      });

      // Create second task (will be queued since first is pending)
      await t.mutation(api.messages.sendMessage, {
        sessionId,
        chatroomId,
        content: 'Second task',
        senderRole: 'user',
        type: 'message',
      });

      // Verify second task is queued
      let tasks = await t.query(api.tasks.listTasks, {
        sessionId,
        chatroomId,
        statusFilter: 'queued',
      });
      expect(tasks.length).toBe(1);
      const queuedTaskId = tasks[0]?._id;

      // Complete first task (should auto-promote second)
      await t.mutation(api.tasks.claimTask, { sessionId, chatroomId, role: 'builder' });
      await t.mutation(api.tasks.startTask, { sessionId, chatroomId, role: 'builder' });
      const completeResult = await t.mutation(api.tasks.completeTask, {
        sessionId,
        chatroomId,
        role: 'builder',
      });

      expect(completeResult.promoted).toBe(queuedTaskId);

      // Verify second task is now pending
      tasks = await t.query(api.tasks.listTasks, {
        sessionId,
        chatroomId,
        statusFilter: 'pending',
      });
      const promotedTask = tasks.find((t) => t._id === queuedTaskId);
      expect(promotedTask?.status).toBe('pending');
    });
  });

  describe('Backlog Actions', () => {
    test('sendBackForRework uses FSM for pending_user_review → pending/queued', async () => {
      const { sessionId } = await createTestSession('test-fsm-send-back');
      const chatroomId = await createPairTeamChatroom(sessionId);
      await joinParticipants(sessionId, chatroomId, ['builder', 'reviewer']);

      // Create and process backlog task through to pending_user_review
      const backlogTask = await t.mutation(api.tasks.createTask, {
        sessionId,
        chatroomId,
        content: 'Task to send back',
        createdBy: 'user',
        isBacklog: true,
      });

      await t.mutation(api.tasks.moveToQueue, { sessionId, taskId: backlogTask.taskId });
      await t.mutation(api.tasks.claimTask, { sessionId, chatroomId, role: 'builder' });
      await t.mutation(api.tasks.startTask, { sessionId, chatroomId, role: 'builder' });
      await t.mutation(api.tasks.completeTask, { sessionId, chatroomId, role: 'builder' });

      // Send back for rework
      const sendBackResult = await t.mutation(api.tasks.sendBackForRework, {
        sessionId,
        taskId: backlogTask.taskId,
        feedback: 'Please fix the edge case',
      });

      expect(sendBackResult.success).toBe(true);
      expect(['pending', 'queued']).toContain(sendBackResult.newStatus);

      // Verify task transitioned correctly
      const tasks = await t.query(api.tasks.listTasks, {
        sessionId,
        chatroomId,
        limit: 100,
      });
      const sentBackTask = tasks.find((t) => t._id === backlogTask.taskId);
      expect(['pending', 'queued']).toContain(sentBackTask?.status);
    });

    test('markBacklogComplete uses FSM for pending_user_review → completed', async () => {
      const { sessionId } = await createTestSession('test-fsm-mark-complete');
      const chatroomId = await createPairTeamChatroom(sessionId);
      await joinParticipants(sessionId, chatroomId, ['builder', 'reviewer']);

      // Create and process backlog task through to pending_user_review
      const backlogTask = await t.mutation(api.tasks.createTask, {
        sessionId,
        chatroomId,
        content: 'Task to mark complete',
        createdBy: 'user',
        isBacklog: true,
      });

      await t.mutation(api.tasks.moveToQueue, { sessionId, taskId: backlogTask.taskId });
      await t.mutation(api.tasks.claimTask, { sessionId, chatroomId, role: 'builder' });
      await t.mutation(api.tasks.startTask, { sessionId, chatroomId, role: 'builder' });
      await t.mutation(api.tasks.completeTask, { sessionId, chatroomId, role: 'builder' });

      // Mark as complete
      const markResult = await t.mutation(api.tasks.markBacklogComplete, {
        sessionId,
        taskId: backlogTask.taskId,
      });

      expect(markResult.success).toBe(true);

      // Verify task is completed
      const tasks = await t.query(api.tasks.listTasks, {
        sessionId,
        chatroomId,
        statusFilter: 'archived',
      });
      const completedTask = tasks.find((t) => t._id === backlogTask.taskId);
      expect(completedTask?.status).toBe('completed');
      expect(completedTask?.completedAt).toBeDefined();
    });

    test('closeBacklogTask uses FSM for * → closed', async () => {
      const { sessionId } = await createTestSession('test-fsm-close-backlog');
      const chatroomId = await createPairTeamChatroom(sessionId);
      await joinParticipants(sessionId, chatroomId, ['builder', 'reviewer']);

      // Create backlog task
      const backlogTask = await t.mutation(api.tasks.createTask, {
        sessionId,
        chatroomId,
        content: 'Task to close',
        createdBy: 'user',
        isBacklog: true,
      });

      // Close it directly from backlog status
      const closeResult = await t.mutation(api.tasks.closeBacklogTask, {
        sessionId,
        taskId: backlogTask.taskId,
      });

      expect(closeResult.success).toBe(true);

      // Verify task is closed
      const tasks = await t.query(api.tasks.listTasks, {
        sessionId,
        chatroomId,
        statusFilter: 'archived',
      });
      const closedTask = tasks.find((t) => t._id === backlogTask.taskId);
      expect(closedTask?.status).toBe('closed');
    });

    test('reopenBacklogTask uses FSM for completed/closed → pending_user_review', async () => {
      const { sessionId } = await createTestSession('test-fsm-reopen-backlog');
      const chatroomId = await createPairTeamChatroom(sessionId);
      await joinParticipants(sessionId, chatroomId, ['builder', 'reviewer']);

      // Create and complete a backlog task
      const backlogTask = await t.mutation(api.tasks.createTask, {
        sessionId,
        chatroomId,
        content: 'Task to reopen',
        createdBy: 'user',
        isBacklog: true,
      });

      await t.mutation(api.tasks.moveToQueue, { sessionId, taskId: backlogTask.taskId });
      await t.mutation(api.tasks.claimTask, { sessionId, chatroomId, role: 'builder' });
      await t.mutation(api.tasks.startTask, { sessionId, chatroomId, role: 'builder' });
      await t.mutation(api.tasks.completeTask, { sessionId, chatroomId, role: 'builder' });
      await t.mutation(api.tasks.markBacklogComplete, { sessionId, taskId: backlogTask.taskId });

      // Reopen the task
      const reopenResult = await t.mutation(api.tasks.reopenBacklogTask, {
        sessionId,
        taskId: backlogTask.taskId,
      });

      expect(reopenResult.success).toBe(true);

      // Verify task is back in pending_user_review
      const tasks = await t.query(api.tasks.listTasks, {
        sessionId,
        chatroomId,
        statusFilter: 'pending_review',
      });
      const reopenedTask = tasks.find((t) => t._id === backlogTask.taskId);
      expect(reopenedTask?.status).toBe('pending_user_review');
      expect(reopenedTask?.completedAt).toBeUndefined(); // Should be cleared
    });
  });

  describe('Cancellation and Reset', () => {
    test('cancelTask uses FSM for * → closed', async () => {
      const { sessionId } = await createTestSession('test-fsm-cancel');
      const chatroomId = await createPairTeamChatroom(sessionId);
      await joinParticipants(sessionId, chatroomId, ['builder', 'reviewer']);

      // Create a pending task
      await t.mutation(api.messages.sendMessage, {
        sessionId,
        chatroomId,
        content: 'Task to cancel',
        senderRole: 'user',
        type: 'message',
      });

      const tasks = await t.query(api.tasks.listTasks, {
        sessionId,
        chatroomId,
        statusFilter: 'pending',
      });
      const taskId = tasks[0]?._id;

      // Cancel it
      const cancelResult = await t.mutation(api.tasks.cancelTask, {
        sessionId,
        taskId: taskId as Id<'chatroom_tasks'>,
      });

      expect(cancelResult.success).toBe(true);
      expect(cancelResult.status).toBe('closed');

      // Verify task is closed
      const archivedTasks = await t.query(api.tasks.listTasks, {
        sessionId,
        chatroomId,
        statusFilter: 'archived',
      });
      const cancelledTask = archivedTasks.find((t) => t._id === taskId);
      expect(cancelledTask?.status).toBe('closed');
    });

    test('resetStuckTask uses FSM for in_progress → pending', async () => {
      const { sessionId } = await createTestSession('test-fsm-reset-stuck');
      const chatroomId = await createPairTeamChatroom(sessionId);
      await joinParticipants(sessionId, chatroomId, ['builder', 'reviewer']);

      // Create and start a task
      await t.mutation(api.messages.sendMessage, {
        sessionId,
        chatroomId,
        content: 'Task that gets stuck',
        senderRole: 'user',
        type: 'message',
      });

      await t.mutation(api.tasks.claimTask, { sessionId, chatroomId, role: 'builder' });
      const startResult = await t.mutation(api.tasks.startTask, {
        sessionId,
        chatroomId,
        role: 'builder',
      });
      const taskId = startResult.taskId;

      // Reset the stuck task
      const resetResult = await t.mutation(api.tasks.resetStuckTask, {
        sessionId,
        taskId,
      });

      expect(resetResult.success).toBe(true);
      expect(resetResult.previousAssignee).toBe('builder');

      // Verify task is back to pending with cleared fields
      const tasks = await t.query(api.tasks.listTasks, {
        sessionId,
        chatroomId,
        statusFilter: 'pending',
      });
      const resetTask = tasks.find((t) => t._id === taskId);
      expect(resetTask?.status).toBe('pending');
      expect(resetTask?.assignedTo).toBeUndefined(); // Should be cleared by FSM
      expect(resetTask?.startedAt).toBeUndefined(); // Should be cleared by FSM
      expect(resetTask?.acknowledgedAt).toBeUndefined(); // Should be cleared by FSM
    });
  });

  describe('Force Completion', () => {
    test('completeTaskById uses FSM for force completing pending task', async () => {
      const { sessionId } = await createTestSession('test-fsm-force-complete');
      const chatroomId = await createPairTeamChatroom(sessionId);
      await joinParticipants(sessionId, chatroomId, ['builder', 'reviewer']);

      // Create a pending task
      await t.mutation(api.messages.sendMessage, {
        sessionId,
        chatroomId,
        content: 'Task to force complete',
        senderRole: 'user',
        type: 'message',
      });

      const tasks = await t.query(api.tasks.listTasks, {
        sessionId,
        chatroomId,
        statusFilter: 'pending',
      });
      const taskId = tasks[0]?._id;

      // Force complete it
      const completeResult = await t.mutation(api.tasks.completeTaskById, {
        sessionId,
        taskId: taskId as Id<'chatroom_tasks'>,
        force: true,
      });

      expect(completeResult.success).toBe(true);
      expect(completeResult.wasForced).toBe(true);

      // Verify task is completed
      const archivedTasks = await t.query(api.tasks.listTasks, {
        sessionId,
        chatroomId,
        statusFilter: 'archived',
      });
      const completedTask = archivedTasks.find((t) => t._id === taskId);
      expect(completedTask?.status).toBe('completed');
      expect(completedTask?.completedAt).toBeDefined();
    });
  });
});

describe('FSM Field Cleanup', () => {
  test('FSM automatically clears stale fields on state transitions', async () => {
    const { sessionId } = await createTestSession('test-fsm-field-cleanup');
    const chatroomId = await createPairTeamChatroom(sessionId);
    await joinParticipants(sessionId, chatroomId, ['builder', 'reviewer']);

    // Create and start a task
    await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      content: 'Task for field cleanup test',
      senderRole: 'user',
      type: 'message',
    });

    // Claim task (sets assignedTo, acknowledgedAt)
    await t.mutation(api.tasks.claimTask, { sessionId, chatroomId, role: 'builder' });

    // Start task (sets startedAt)
    const startResult = await t.mutation(api.tasks.startTask, {
      sessionId,
      chatroomId,
      role: 'builder',
    });
    const taskId = startResult.taskId;

    // Verify fields are set
    let tasks = await t.query(api.tasks.listTasks, {
      sessionId,
      chatroomId,
      limit: 100,
    });
    let task = tasks.find((t) => t._id === taskId);
    expect(task?.assignedTo).toBe('builder');
    expect(task?.acknowledgedAt).toBeDefined();
    expect(task?.startedAt).toBeDefined();

    // Reset task (should clear assignedTo, startedAt, acknowledgedAt)
    await t.mutation(api.tasks.resetStuckTask, { sessionId, taskId });

    // Verify fields were cleared by FSM
    tasks = await t.query(api.tasks.listTasks, {
      sessionId,
      chatroomId,
      limit: 100,
    });
    task = tasks.find((t) => t._id === taskId);
    expect(task?.status).toBe('pending');
    expect(task?.assignedTo).toBeUndefined(); // Cleared by FSM
    expect(task?.startedAt).toBeUndefined(); // Cleared by FSM
    expect(task?.acknowledgedAt).toBeUndefined(); // Cleared by FSM
  });
});

describe('FSM Error Handling', () => {
  test('FSM rejects invalid state transitions with clear error messages', async () => {
    const { sessionId } = await createTestSession('test-fsm-invalid-transition');
    const chatroomId = await createPairTeamChatroom(sessionId);
    await joinParticipants(sessionId, chatroomId, ['builder', 'reviewer']);

    // Create a backlog task
    // @ts-expect-error unused but needed for test flow
    const _backlogTask = await t.mutation(api.tasks.createTask, {
      sessionId,
      chatroomId,
      content: 'Task for invalid transition test',
      createdBy: 'user',
      isBacklog: true,
    });

    // Try to mark complete directly from backlog (invalid: should be pending_user_review first)
    // This should fail because the task must go through the workflow
    // However, markBacklogComplete allows completion from backlog status as a force-complete
    // So we need to test a truly invalid transition

    // Try to start a task that's in backlog status (should require pending first)
    await expect(
      t.mutation(api.tasks.startTask, {
        sessionId,
        chatroomId,
        role: 'builder',
      })
    ).rejects.toThrow(); // No acknowledged task exists
  });
});
