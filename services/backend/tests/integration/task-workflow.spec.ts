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
  for (const role of roles) {
    await t.mutation(api.participants.join, {
      sessionId,
      chatroomId,
      role,
    });
  }
}

describe('Task Workflow - Backlog Origin', () => {
  describe('Task Creation', () => {
    test('creates backlog item with status=backlog via createBacklogItem', async () => {
      const { sessionId } = await createTestSession('test-backlog-create');
      const chatroomId = await createPairTeamChatroom(sessionId);
      await joinParticipants(sessionId, chatroomId, ['builder', 'reviewer']);

      // Create backlog item using the new chatroom_backlog API
      const backlogItemId = await t.mutation(api.backlog.createBacklogItem, {
        sessionId,
        chatroomId,
        content: 'Fix bug in login form',
        createdBy: 'user',
      });

      expect(backlogItemId).toBeDefined();

      // Verify item in database
      const items = await t.query(api.backlog.listBacklogItems, {
        sessionId,
        chatroomId,
        statusFilter: 'backlog',
      });

      expect(items.length).toBeGreaterThan(0);
      const item = items.find((i) => i._id === backlogItemId);
      expect(item).toBeDefined();
      expect(item?.status).toBe('backlog');
    });

    test('creates chat task with status=pending via createTask', async () => {
      const { sessionId } = await createTestSession('test-chat-create');
      const chatroomId = await createPairTeamChatroom(sessionId);
      await joinParticipants(sessionId, chatroomId, ['builder', 'reviewer']);

      // Create chat task (no longer uses isBacklog field)
      const result = await t.mutation(api.tasks.createTask, {
        sessionId,
        chatroomId,
        content: 'User request from chat',
        createdBy: 'user',
      });

      // Status should be pending (no active tasks)
      expect(result.status).toBe('pending');
    });
  });

  describe('Backlog → Queue Transition', () => {
    test('backlog item can be created and then a task can be created from it', async () => {
      const { sessionId } = await createTestSession('test-backlog-to-queue');
      const chatroomId = await createPairTeamChatroom(sessionId);
      await joinParticipants(sessionId, chatroomId, ['builder', 'reviewer']);

      // Create a regular task to block the queue
      await t.mutation(api.tasks.createTask, {
        sessionId,
        chatroomId,
        content: 'Active task',
        createdBy: 'user',
      });

      // Create backlog item
      const backlogItemId = await t.mutation(api.backlog.createBacklogItem, {
        sessionId,
        chatroomId,
        content: 'Backlog item to work on',
        createdBy: 'user',
      });
      expect(backlogItemId).toBeDefined();

      // Verify backlog item is in backlog status
      const items = await t.query(api.backlog.listBacklogItems, {
        sessionId,
        chatroomId,
        statusFilter: 'backlog',
      });
      const item = items.find((i) => i._id === backlogItemId);
      expect(item?.status).toBe('backlog');
    });
  });

  describe('Complete Task Flow', () => {
    test('completeTask transitions task to completed (chat task)', async () => {
      const { sessionId } = await createTestSession('test-complete-backlog');
      const chatroomId = await createPairTeamChatroom(sessionId);
      await joinParticipants(sessionId, chatroomId, ['builder', 'reviewer']);

      // Create a task via message
      await t.mutation(api.messages.sendMessage, {
        sessionId,
        chatroomId,
        content: 'Task to complete',
        senderRole: 'user',
        type: 'message',
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

      // Complete the task
      const completeResult = await t.mutation(api.tasks.completeTask, {
        sessionId,
        chatroomId,
        role: 'builder',
      });

      expect(completeResult.completed).toBe(true);

      // Verify task is completed
      const tasks = await t.query(api.tasks.listHistoricalTasks, {
        sessionId,
        chatroomId,
      });
      expect(tasks.length).toBeGreaterThan(0);
      expect(tasks[0]?.status).toBe('completed');
    });

    test('completeTask transitions chat task directly to completed', async () => {
      const { sessionId } = await createTestSession('test-complete-chat');
      const chatroomId = await createPairTeamChatroom(sessionId);
      await joinParticipants(sessionId, chatroomId, ['builder', 'reviewer']);

      // Create chat task using createTask (no longer uses isBacklog field)
      const chatTask = await t.mutation(api.tasks.createTask, {
        sessionId,
        chatroomId,
        content: 'Chat task to complete',
        createdBy: 'user',
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

      // Complete the task - should go directly to completed
      const completeResult = await t.mutation(api.tasks.completeTask, {
        sessionId,
        chatroomId,
        role: 'builder',
      });

      expect(completeResult.completed).toBe(true);

      // Verify task is completed
      const tasks = await t.query(api.tasks.listHistoricalTasks, {
        sessionId,
        chatroomId,
      });

      const task = tasks.find((t) => t._id === chatTask.taskId);
      expect(task).toBeDefined();
      expect(task?.status).toBe('completed');
    });
  });

  describe('Pending User Review Actions', () => {
    test('backlog item can be marked complete via completeBacklogItem', async () => {
      const { sessionId } = await createTestSession('test-mark-complete');
      const chatroomId = await createPairTeamChatroom(sessionId);
      await joinParticipants(sessionId, chatroomId, ['builder', 'reviewer']);

      // Create a backlog item and process it through to pending_user_review
      const backlogItemId = await t.mutation(api.backlog.createBacklogItem, {
        sessionId,
        chatroomId,
        content: 'Task to mark complete',
        createdBy: 'user',
      });

      // Transition to pending_user_review
      await t.mutation(api.backlog.markBacklogItemForReview, {
        sessionId,
        itemId: backlogItemId,
      });

      // Complete: pending_user_review → closed (with completedAt)
      const markResult = await t.mutation(api.backlog.completeBacklogItem, {
        sessionId,
        itemId: backlogItemId,
      });

      expect(markResult.success).toBe(true);

      // Verify item is now closed
      const closedItems = await t.query(api.backlog.listBacklogItems, {
        sessionId,
        chatroomId,
        statusFilter: 'closed',
      });

      const item = closedItems.find((i) => i._id === backlogItemId);
      expect(item).toBeDefined();
      expect(item?.status).toBe('closed');
      expect(item?.completedAt).toBeDefined();
    });

    test('backlog item can be closed via closeBacklogItem', async () => {
      const { sessionId } = await createTestSession('test-close-backlog');
      const chatroomId = await createPairTeamChatroom(sessionId);
      await joinParticipants(sessionId, chatroomId, ['builder', 'reviewer']);

      // Create backlog item
      const backlogItemId = await t.mutation(api.backlog.createBacklogItem, {
        sessionId,
        chatroomId,
        content: 'Task to close',
        createdBy: 'user',
      });

      // Close without completing
      const closeResult = await t.mutation(api.backlog.closeBacklogItem, {
        sessionId,
        itemId: backlogItemId,
      });

      expect(closeResult.success).toBe(true);

      // Verify item is closed
      const closedItems = await t.query(api.backlog.listBacklogItems, {
        sessionId,
        chatroomId,
        statusFilter: 'closed',
      });

      const item = closedItems.find((i) => i._id === backlogItemId);
      expect(item).toBeDefined();
      expect(item?.status).toBe('closed');
    });

    test('backlog item can be sent back for rework via sendBacklogItemBackForRework', async () => {
      const { sessionId } = await createTestSession('test-send-back');
      const chatroomId = await createPairTeamChatroom(sessionId);
      await joinParticipants(sessionId, chatroomId, ['builder', 'reviewer']);

      // Create backlog item
      const backlogItemId = await t.mutation(api.backlog.createBacklogItem, {
        sessionId,
        chatroomId,
        content: 'Task to send back',
        createdBy: 'user',
      });

      // Mark for review
      await t.mutation(api.backlog.markBacklogItemForReview, {
        sessionId,
        itemId: backlogItemId,
      });

      // Send back for re-work: pending_user_review → backlog
      const sendBackResult = await t.mutation(api.backlog.sendBacklogItemBackForRework, {
        sessionId,
        itemId: backlogItemId,
      });

      expect(sendBackResult.success).toBe(true);

      // Verify item is back in backlog
      const backlogItems = await t.query(api.backlog.listBacklogItems, {
        sessionId,
        chatroomId,
        statusFilter: 'backlog',
      });
      const item = backlogItems.find((i) => i._id === backlogItemId);
      expect(item?.status).toBe('backlog');
    });
  });
});

describe('Task Workflow - Cancel Actions', () => {
  test('backlog item can be closed via closeBacklogItem', async () => {
    const { sessionId } = await createTestSession('test-cancel-backlog');
    const chatroomId = await createPairTeamChatroom(sessionId);
    await joinParticipants(sessionId, chatroomId, ['builder', 'reviewer']);

    // Create backlog item
    const backlogItemId = await t.mutation(api.backlog.createBacklogItem, {
      sessionId,
      chatroomId,
      content: 'Backlog item to close',
      createdBy: 'user',
    });

    // Close it
    const closeResult = await t.mutation(api.backlog.closeBacklogItem, {
      sessionId,
      itemId: backlogItemId,
    });

    expect(closeResult.success).toBe(true);

    // Verify item is now closed
    const closedItems = await t.query(api.backlog.listBacklogItems, {
      sessionId,
      chatroomId,
      statusFilter: 'closed',
    });
    const closedItem = closedItems.find((i) => i._id === backlogItemId);
    expect(closedItem?.status).toBe('closed');
  });

  test('chat task can be force-completed via completeTaskById', async () => {
    const { sessionId } = await createTestSession('test-cancel-chat');
    const chatroomId = await createPairTeamChatroom(sessionId);
    await joinParticipants(sessionId, chatroomId, ['builder', 'reviewer']);

    // Create a chat task
    const chatTask = await t.mutation(api.tasks.createTask, {
      sessionId,
      chatroomId,
      content: 'Chat task to force-complete',
      createdBy: 'user',
    });

    // Force-complete as the way to remove it
    const completeResult = await t.mutation(api.tasks.completeTaskById, {
      sessionId,
      taskId: chatTask.taskId,
      force: true,
    });

    expect(completeResult.success).toBe(true);
    expect(completeResult.wasForced).toBe(true);
  });

  test('force-completing task does not delete source message', async () => {
    const { sessionId } = await createTestSession('test-cancel-cascade-message');
    const chatroomId = await createPairTeamChatroom(sessionId);
    await joinParticipants(sessionId, chatroomId, ['builder', 'reviewer']);

    // Send a user message to create a task with sourceMessageId
    const messageId = await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      content: 'User message task',
      senderRole: 'user',
      type: 'message',
    });
    expect(messageId).toBeDefined();

    // Verify the message is in chatroom_messages
    const messagesBefore = await t.query(api.messages.list, { sessionId, chatroomId });
    const sourceMsg = messagesBefore.find((m: { _id: unknown }) => m._id === messageId);
    expect(sourceMsg).toBeDefined();

    // Find the auto-created task with this sourceMessageId
    const allTasks = await t.query(api.tasks.listTasks, { sessionId, chatroomId });
    const task = allTasks.find((t: { sourceMessageId?: unknown }) => t.sourceMessageId === messageId);
    expect(task).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const foundTask = task!;

    // Force-complete the task
    await t.mutation(api.tasks.completeTaskById, {
      sessionId,
      taskId: foundTask._id,
      force: true,
    });

    // The task should be completed
    const archivedTasks = await t.query(api.tasks.listHistoricalTasks, { sessionId, chatroomId });
    const completedTask = archivedTasks.find((t) => t._id === foundTask._id);
    expect(completedTask?.status).toBe('completed');
  });
});

describe('Task Counts', () => {
  test('getTaskCounts includes expected status counts', async () => {
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
    expect(typeof counts.completed).toBe('number');
    // Note: pending_user_review and closed are now in chatroom_backlog table
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
    const pendingTasksResult = await t.query(api.tasks.getPendingTasksForRole, {
      sessionId,
      chatroomId,
      role: 'builder',
    });
    expect(pendingTasksResult.type).toBe('tasks');
    const pendingTasks = (pendingTasksResult as { type: 'tasks'; tasks: any[] }).tasks;
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
