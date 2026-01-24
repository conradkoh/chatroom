/**
 * Task Workflow Integration Tests
 *
 * Tests for the new task status workflow with origin-based state machines.
 *
 * Backlog workflow: backlog → queued → pending → in_progress → pending_user_review → completed/closed
 * Chat workflow: queued → pending → in_progress → completed
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

describe('Task Workflow - Backlog Origin', () => {
  describe('Task Creation', () => {
    test('creates backlog task with origin=backlog and status=backlog', async () => {
      const { sessionId } = await createTestSession('test-backlog-create');
      const chatroomId = await createPairTeamChatroom(sessionId);
      await joinParticipants(sessionId, chatroomId, ['builder', 'reviewer']);

      // Create backlog task
      const result = await t.mutation(api.tasks.createTask, {
        sessionId,
        chatroomId,
        content: 'Fix bug in login form',
        createdBy: 'user',
        isBacklog: true,
      });

      expect(result.status).toBe('backlog');
      expect(result.origin).toBe('backlog');

      // Verify task in database
      const tasks = await t.query(api.tasks.listTasks, {
        sessionId,
        chatroomId,
        statusFilter: 'backlog',
      });

      expect(tasks.length).toBeGreaterThan(0);
      const task = tasks.find((t) => t._id === result.taskId);
      expect(task).toBeDefined();
      expect(task?.status).toBe('backlog');
      expect(task?.origin).toBe('backlog');
    });

    test('creates chat task with origin=chat', async () => {
      const { sessionId } = await createTestSession('test-chat-create');
      const chatroomId = await createPairTeamChatroom(sessionId);
      await joinParticipants(sessionId, chatroomId, ['builder', 'reviewer']);

      // Create chat task (not backlog)
      const result = await t.mutation(api.tasks.createTask, {
        sessionId,
        chatroomId,
        content: 'User request from chat',
        createdBy: 'user',
        isBacklog: false,
      });

      expect(result.origin).toBe('chat');
      // Status should be pending (no active tasks) or queued
      expect(['pending', 'queued']).toContain(result.status);
    });
  });

  describe('Backlog → Queue Transition', () => {
    test('moveToQueue transitions backlog task to queued', async () => {
      const { sessionId } = await createTestSession('test-backlog-to-queue');
      const chatroomId = await createPairTeamChatroom(sessionId);
      await joinParticipants(sessionId, chatroomId, ['builder', 'reviewer']);

      // Create an active task first to ensure new task goes to queue
      await t.mutation(api.tasks.createTask, {
        sessionId,
        chatroomId,
        content: 'Active task',
        createdBy: 'user',
        isBacklog: false,
      });

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
      expect(moveResult.newStatus).toBe('queued');
    });
  });

  describe('Complete Task Flow', () => {
    test('completeTask transitions backlog-origin task to pending_user_review', async () => {
      const { sessionId } = await createTestSession('test-complete-backlog');
      const chatroomId = await createPairTeamChatroom(sessionId);
      await joinParticipants(sessionId, chatroomId, ['builder', 'reviewer']);

      // Create backlog task
      const backlogTask = await t.mutation(api.tasks.createTask, {
        sessionId,
        chatroomId,
        content: 'Task to complete',
        createdBy: 'user',
        isBacklog: true,
      });

      // Move to queue (it should become pending since no active task)
      await t.mutation(api.tasks.moveToQueue, {
        sessionId,
        taskId: backlogTask.taskId,
      });

      // Claim and start the task (FSM workflow)
      await t.mutation(api.tasks.claimTask, {
        sessionId,
        chatroomId,
        role: 'builder',
      });

      await t.mutation(api.tasks.startTask, {
        sessionId,
        chatroomId,
        role: 'builder',
      });

      // Complete the task - should go to pending_user_review for backlog
      const completeResult = await t.mutation(api.tasks.completeTask, {
        sessionId,
        chatroomId,
        role: 'builder',
      });

      expect(completeResult.completed).toBe(true);
      expect(completeResult.pendingReview.length).toBeGreaterThan(0);

      // Verify task is in pending_user_review status
      const reviewTasks = await t.query(api.tasks.listTasks, {
        sessionId,
        chatroomId,
        statusFilter: 'pending_review',
      });

      const task = reviewTasks.find((t) => t._id === backlogTask.taskId);
      expect(task).toBeDefined();
      expect(task?.status).toBe('pending_user_review');
    });

    test('completeTask transitions chat-origin task directly to completed', async () => {
      const { sessionId } = await createTestSession('test-complete-chat');
      const chatroomId = await createPairTeamChatroom(sessionId);
      await joinParticipants(sessionId, chatroomId, ['builder', 'reviewer']);

      // Create chat task
      const chatTask = await t.mutation(api.tasks.createTask, {
        sessionId,
        chatroomId,
        content: 'Chat task to complete',
        createdBy: 'user',
        isBacklog: false,
      });

      // Claim and start the task (FSM workflow)
      await t.mutation(api.tasks.claimTask, {
        sessionId,
        chatroomId,
        role: 'builder',
      });

      await t.mutation(api.tasks.startTask, {
        sessionId,
        chatroomId,
        role: 'builder',
      });

      // Complete the task - should go directly to completed for chat
      const completeResult = await t.mutation(api.tasks.completeTask, {
        sessionId,
        chatroomId,
        role: 'builder',
      });

      expect(completeResult.completed).toBe(true);
      expect(completeResult.pendingReview.length).toBe(0);

      // Verify task is completed
      const tasks = await t.query(api.tasks.listTasks, {
        sessionId,
        chatroomId,
        statusFilter: 'archived',
      });

      const task = tasks.find((t) => t._id === chatTask.taskId);
      expect(task).toBeDefined();
      expect(task?.status).toBe('completed');
    });
  });

  describe('Pending User Review Actions', () => {
    test('markBacklogComplete transitions pending_user_review to completed', async () => {
      const { sessionId } = await createTestSession('test-mark-complete');
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

      await t.mutation(api.tasks.moveToQueue, {
        sessionId,
        taskId: backlogTask.taskId,
      });

      await t.mutation(api.tasks.claimTask, {
        sessionId,
        chatroomId,
        role: 'builder',
      });

      await t.mutation(api.tasks.startTask, {
        sessionId,
        chatroomId,
        role: 'builder',
      });

      await t.mutation(api.tasks.completeTask, {
        sessionId,
        chatroomId,
        role: 'builder',
      });

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

      const task = tasks.find((t) => t._id === backlogTask.taskId);
      expect(task).toBeDefined();
      expect(task?.status).toBe('completed');
    });

    test('closeBacklogTask transitions to closed status', async () => {
      const { sessionId } = await createTestSession('test-close-backlog');
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

      // Move and process through to pending_user_review
      await t.mutation(api.tasks.moveToQueue, {
        sessionId,
        taskId: backlogTask.taskId,
      });

      await t.mutation(api.tasks.claimTask, {
        sessionId,
        chatroomId,
        role: 'builder',
      });

      await t.mutation(api.tasks.startTask, {
        sessionId,
        chatroomId,
        role: 'builder',
      });

      await t.mutation(api.tasks.completeTask, {
        sessionId,
        chatroomId,
        role: 'builder',
      });

      // Close without completing
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

      const task = tasks.find((t) => t._id === backlogTask.taskId);
      expect(task).toBeDefined();
      expect(task?.status).toBe('closed');
    });

    test('sendBackForRework transitions pending_user_review back to queue', async () => {
      const { sessionId } = await createTestSession('test-send-back');
      const chatroomId = await createPairTeamChatroom(sessionId);
      await joinParticipants(sessionId, chatroomId, ['builder', 'reviewer']);

      // Create and process task through to pending_user_review
      const backlogTask = await t.mutation(api.tasks.createTask, {
        sessionId,
        chatroomId,
        content: 'Task to send back',
        createdBy: 'user',
        isBacklog: true,
      });

      await t.mutation(api.tasks.moveToQueue, {
        sessionId,
        taskId: backlogTask.taskId,
      });

      await t.mutation(api.tasks.claimTask, {
        sessionId,
        chatroomId,
        role: 'builder',
      });

      await t.mutation(api.tasks.startTask, {
        sessionId,
        chatroomId,
        role: 'builder',
      });

      await t.mutation(api.tasks.completeTask, {
        sessionId,
        chatroomId,
        role: 'builder',
      });

      // Send back for re-work
      const sendBackResult = await t.mutation(api.tasks.sendBackForRework, {
        sessionId,
        taskId: backlogTask.taskId,
        feedback: 'Please fix the edge case',
      });

      expect(sendBackResult.success).toBe(true);
      // Should go to pending (no active task) or queued
      expect(['pending', 'queued']).toContain(sendBackResult.newStatus);
    });
  });
});

describe('Task Workflow - Cancel Actions', () => {
  test('cancelTask uses closed status for backlog-origin tasks', async () => {
    const { sessionId } = await createTestSession('test-cancel-backlog');
    const chatroomId = await createPairTeamChatroom(sessionId);
    await joinParticipants(sessionId, chatroomId, ['builder', 'reviewer']);

    // Create backlog task
    const backlogTask = await t.mutation(api.tasks.createTask, {
      sessionId,
      chatroomId,
      content: 'Backlog task to cancel',
      createdBy: 'user',
      isBacklog: true,
    });

    // Cancel it
    const cancelResult = await t.mutation(api.tasks.cancelTask, {
      sessionId,
      taskId: backlogTask.taskId,
    });

    expect(cancelResult.success).toBe(true);
    expect(cancelResult.status).toBe('closed');
  });

  test('cancelTask uses cancelled status for chat-origin tasks', async () => {
    const { sessionId } = await createTestSession('test-cancel-chat');
    const chatroomId = await createPairTeamChatroom(sessionId);
    await joinParticipants(sessionId, chatroomId, ['builder', 'reviewer']);

    // Create another task first so new one goes to queue
    await t.mutation(api.tasks.createTask, {
      sessionId,
      chatroomId,
      content: 'First task',
      createdBy: 'user',
      isBacklog: false,
    });

    // Create chat task (will be queued)
    const chatTask = await t.mutation(api.tasks.createTask, {
      sessionId,
      chatroomId,
      content: 'Chat task to cancel',
      createdBy: 'user',
      isBacklog: false,
    });

    // Cancel it - now always uses 'closed' status
    const cancelResult = await t.mutation(api.tasks.cancelTask, {
      sessionId,
      taskId: chatTask.taskId,
    });

    expect(cancelResult.success).toBe(true);
    expect(cancelResult.status).toBe('closed');
  });
});

describe('Task Counts', () => {
  test('getTaskCounts includes new status counts', async () => {
    const { sessionId } = await createTestSession('test-counts');
    const chatroomId = await createPairTeamChatroom(sessionId);
    await joinParticipants(sessionId, chatroomId, ['builder', 'reviewer']);

    const counts = await t.query(api.tasks.getTaskCounts, {
      sessionId,
      chatroomId,
    });

    // Verify all expected status counts exist
    expect(typeof counts.pending).toBe('number');
    expect(typeof counts.in_progress).toBe('number');
    expect(typeof counts.queued).toBe('number');
    expect(typeof counts.backlog).toBe('number');
    expect(typeof counts.pending_user_review).toBe('number');
    expect(typeof counts.completed).toBe('number');
    expect(typeof counts.closed).toBe('number');
  });
});

describe('Task Workflow - Race Conditions', () => {
  test('startTask throws error when no acknowledged task exists (FSM workflow)', async () => {
    const { sessionId } = await createTestSession('test-race-no-acknowledged');
    const chatroomId = await createPairTeamChatroom(sessionId);
    await joinParticipants(sessionId, chatroomId, ['builder', 'reviewer']);

    // Try to start a task when none is acknowledged - simulates race where another agent claimed it
    await expect(
      t.mutation(api.tasks.startTask, {
        sessionId,
        chatroomId,
        role: 'builder',
      })
    ).rejects.toThrow('No acknowledged task to start for this role');
  });

  test('second claimTask call fails when task already acknowledged', async () => {
    const { sessionId } = await createTestSession('test-race-double-claim');
    const chatroomId = await createPairTeamChatroom(sessionId);
    await joinParticipants(sessionId, chatroomId, ['builder', 'reviewer']);

    // Create a pending task
    await t.mutation(api.tasks.createTask, {
      sessionId,
      chatroomId,
      content: 'Race condition test task',
      createdBy: 'user',
      isBacklog: false,
    });

    // First agent claims the task
    const result = await t.mutation(api.tasks.claimTask, {
      sessionId,
      chatroomId,
      role: 'builder',
    });
    expect(result.taskId).toBeDefined();

    // Second agent tries to claim - should fail
    await expect(
      t.mutation(api.tasks.claimTask, {
        sessionId,
        chatroomId,
        role: 'reviewer', // Different role trying to claim
      })
    ).rejects.toThrow('No pending task to claim');
  });

  test('task start and message claim are independent operations', async () => {
    const { sessionId } = await createTestSession('test-task-message-lifecycle');
    const chatroomId = await createPairTeamChatroom(sessionId);
    await joinParticipants(sessionId, chatroomId, ['builder', 'reviewer']);

    // Create a task via message (simulates user sending message)
    const messageId = await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      content: 'Please implement feature X',
      senderRole: 'user',
      type: 'message',
    });
    expect(messageId).toBeDefined();

    // Verify a pending task was created
    const pendingTasks = await t.query(api.tasks.getPendingTasksForRole, {
      sessionId,
      chatroomId,
      role: 'builder',
    });
    expect(pendingTasks.length).toBe(1);

    // Claim and start the task (FSM workflow)
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
    expect(startResult.taskId).toBeDefined();

    // Verify task is now in_progress
    const tasks = await t.query(api.tasks.listTasks, {
      sessionId,
      chatroomId,
      statusFilter: 'in_progress',
    });
    expect(tasks.length).toBe(1);
    expect(tasks[0]?.status).toBe('in_progress');
    expect(tasks[0]?.assignedTo).toBe('builder');
  });
});
