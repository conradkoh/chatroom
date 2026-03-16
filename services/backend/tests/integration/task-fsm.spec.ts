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
 * Helper to join participants to the chatroom with waiting (get-next-task) status
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
      action: 'get-next-task:started',
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
      // User message tasks are pre-assigned to the entry point so the ensure-agent
      // handler knows which agent to restart if nobody is listening.
      expect(tasks[0]?.assignedTo).toBe('builder');
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
      tasks = await t.query(api.tasks.listHistoricalTasks, {
        sessionId,
        chatroomId,
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

    test('startTask is idempotent when task is already in_progress (same role)', async () => {
      const { sessionId } = await createTestSession('test-fsm-start-idempotent-same');
      const chatroomId = await createPairTeamChatroom(sessionId);
      await joinParticipants(sessionId, chatroomId, ['builder', 'reviewer']);

      // Create → send → claim → start → in_progress
      await t.mutation(api.messages.sendMessage, {
        sessionId, chatroomId, content: 'test', senderRole: 'user', type: 'message',
      });
      await t.mutation(api.tasks.claimTask, { sessionId, chatroomId, role: 'builder' });
      const allTasks = await t.query(api.tasks.listTasks, {
        sessionId, chatroomId, statusFilter: 'active',
      });
      const taskId = allTasks.find((t) => t.status === 'acknowledged')?._id;
      expect(taskId).toBeDefined();
      await t.mutation(api.tasks.startTask, { sessionId, chatroomId, role: 'builder', taskId });

      // Second call with same role — should not throw (idempotent)
      await expect(
        t.mutation(api.tasks.startTask, { sessionId, chatroomId, role: 'builder', taskId })
      ).resolves.toMatchObject({ taskId });
    });

    test('startTask accepts in_progress task from a different role (recovering agent takes over)', async () => {
      const { sessionId } = await createTestSession('test-fsm-start-idempotent-diff');
      const chatroomId = await createPairTeamChatroom(sessionId);
      await joinParticipants(sessionId, chatroomId, ['builder', 'reviewer']);

      // Create → send → claim by builder → start → in_progress assigned to builder
      await t.mutation(api.messages.sendMessage, {
        sessionId, chatroomId, content: 'test', senderRole: 'user', type: 'message',
      });
      await t.mutation(api.tasks.claimTask, { sessionId, chatroomId, role: 'builder' });
      const allTasks = await t.query(api.tasks.listTasks, {
        sessionId, chatroomId, statusFilter: 'active',
      });
      const taskId = allTasks.find((t) => t.status === 'acknowledged')?._id;
      expect(taskId).toBeDefined();
      await t.mutation(api.tasks.startTask, { sessionId, chatroomId, role: 'builder', taskId });

      // New agent with role 'planner' picks up the in_progress task (recovery)
      await expect(
        t.mutation(api.tasks.startTask, { sessionId, chatroomId, role: 'planner', taskId })
      ).resolves.toMatchObject({ taskId });

      // Verify assignedTo was updated
      const inProgress = await t.query(api.tasks.listTasks, {
        sessionId, chatroomId, statusFilter: 'in_progress',
      });
      const task = inProgress.find((t: { _id: unknown }) => t._id === taskId) as { assignedTo?: string } | undefined;
      expect(task?.assignedTo).toBe('planner');
    });
  });
});

describe('FSM: Acknowledged to Pending User Review Transition', () => {
  test('acknowledged task can transition to pending_user_review via parentTaskAcknowledged', async () => {
    const { sessionId } = await createTestSession('test-fsm-acknowledged-to-pending-review');
    const chatroomId = await createPairTeamChatroom(sessionId);
    await joinParticipants(sessionId, chatroomId, ['builder', 'reviewer']);

    // Create a backlog item using the new chatroom_backlog API
    const backlogItemId = await t.mutation(api.backlog.createBacklogItem, {
      sessionId,
      chatroomId,
      content: 'Backlog item to attach',
      createdBy: 'user',
    });

    // Send message and attach the backlog item - this creates a parent task
    const messageId = await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      content: 'Please work on this backlog item',
      senderRole: 'user',
      type: 'message',
      attachedBacklogItemIds: [backlogItemId],
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

    // The backlog item status should still be 'backlog' (it's managed separately)
    const backlogItems = await t.query(api.backlog.listBacklogItems, {
      sessionId,
      chatroomId,
      statusFilter: 'backlog',
    });
    const backlogItem = backlogItems.find((i) => i._id === backlogItemId);
    expect(backlogItem?.status).toBe('backlog');
  });
});

describe('FSM Phase 2: Backlog Attachment Tracking', () => {
  describe('Backlog Flow: backlog item attached to message', () => {
    test('attaching backlog item to message creates parent task with backlog item reference', async () => {
      const { sessionId } = await createTestSession('test-fsm-backlog-attachment');
      const chatroomId = await createPairTeamChatroom(sessionId);
      await joinParticipants(sessionId, chatroomId, ['builder', 'reviewer']);

      // Step 1: Create backlog item using the new chatroom_backlog API
      const backlogItemId = await t.mutation(api.backlog.createBacklogItem, {
        sessionId,
        chatroomId,
        content: 'Backlog item for attachment test',
        createdBy: 'user',
      });
      expect(backlogItemId).toBeDefined();

      // Step 2: Send message with attached backlog item
      const messageId = await t.mutation(api.messages.sendMessage, {
        sessionId,
        chatroomId,
        content: 'Please implement this backlog item',
        senderRole: 'user',
        type: 'message',
        attachedBacklogItemIds: [backlogItemId],
      });
      expect(messageId).toBeDefined();

      // Step 3: Verify the task was created from the message
      const tasks = await t.query(api.tasks.listTasks, {
        sessionId,
        chatroomId,
        limit: 100,
      });

      // Step 4: Find the main task and verify it has the backlog item attached
      const mainTask = tasks.find((t) => t.sourceMessageId === messageId);
      expect(mainTask).toBeDefined();

      // Verify the backlog item is still in 'backlog' status (managed independently)
      const backlogItems = await t.query(api.backlog.listBacklogItems, {
        sessionId,
        chatroomId,
        statusFilter: 'backlog',
      });
      const backlogItem = backlogItems.find((i) => i._id === backlogItemId);
      expect(backlogItem?.status).toBe('backlog');
    });

    test('backlog item can be attached to multiple messages (many-to-many)', async () => {
      const { sessionId } = await createTestSession('test-fsm-backlog-many-to-many');
      const chatroomId = await createPairTeamChatroom(sessionId);
      await joinParticipants(sessionId, chatroomId, ['builder', 'reviewer']);

      // Create a backlog item
      const backlogItemId = await t.mutation(api.backlog.createBacklogItem, {
        sessionId,
        chatroomId,
        content: 'Shared backlog item',
        createdBy: 'user',
      });

      // Attach to first message
      const message1 = await t.mutation(api.messages.sendMessage, {
        sessionId,
        chatroomId,
        content: 'First task referencing backlog',
        senderRole: 'user',
        type: 'message',
        attachedBacklogItemIds: [backlogItemId],
      });

      // Complete first task to clear the way
      await t.mutation(api.tasks.claimTask, { sessionId, chatroomId, role: 'builder' });
      await t.mutation(api.tasks.startTask, { sessionId, chatroomId, role: 'builder' });
      await t.mutation(api.tasks.completeTask, { sessionId, chatroomId, role: 'builder' });

      // Attach same backlog item to second message
      const message2 = await t.mutation(api.messages.sendMessage, {
        sessionId,
        chatroomId,
        content: 'Second task referencing same backlog',
        senderRole: 'user',
        type: 'message',
        attachedBacklogItemIds: [backlogItemId],
      });

      // Verify both tasks exist
      const tasks = await t.query(api.tasks.listTasks, {
        sessionId,
        chatroomId,
        limit: 100,
      });

      const mainTask1 = tasks.find((t) => t.sourceMessageId === message1);
      const mainTask2 = tasks.find((t) => t.sourceMessageId === message2);
      expect(mainTask1).toBeDefined();
      expect(mainTask2).toBeDefined();

      // Verify backlog item is still active
      const backlogItems = await t.query(api.backlog.listBacklogItems, {
        sessionId,
        chatroomId,
      });
      const backlogItem = backlogItems.find((i) => i._id === backlogItemId);
      expect(backlogItem).toBeDefined();
      expect(backlogItem?.status).toBe('backlog');
    });
  });
});

describe('FSM Phase 4: All Mutations Use FSM', () => {
  describe('Queue Management', () => {
    test('sending a message creates a pending task directly (no queue when empty)', async () => {
      const { sessionId } = await createTestSession('test-fsm-move-to-queue');
      const chatroomId = await createPairTeamChatroom(sessionId);
      await joinParticipants(sessionId, chatroomId, ['builder', 'reviewer']);

      // Send a message — creates a pending task directly
      const messageId = await t.mutation(api.messages.sendMessage, {
        sessionId,
        chatroomId,
        content: 'New task from message',
        senderRole: 'user',
        type: 'message',
      });
      expect(messageId).toBeDefined();

      // Verify task is pending
      const tasks = await t.query(api.tasks.listTasks, {
        sessionId,
        chatroomId,
        statusFilter: 'pending',
      });
      expect(tasks.length).toBe(1);
      expect(tasks[0]?.status).toBe('pending');
    });

    test('second message gets queued when first task is active', async () => {
      const { sessionId } = await createTestSession('test-fsm-move-pur-pending');
      const chatroomId = await createPairTeamChatroom(sessionId);
      await joinParticipants(sessionId, chatroomId, ['builder', 'reviewer']);

      // First message creates a pending task
      await t.mutation(api.messages.sendMessage, {
        sessionId,
        chatroomId,
        content: 'First task',
        senderRole: 'user',
        type: 'message',
      });

      // Second message should be queued
      await t.mutation(api.messages.sendMessage, {
        sessionId,
        chatroomId,
        content: 'Second task',
        senderRole: 'user',
        type: 'message',
      });

      // Verify second message is in queue
      const queuedMessages = await t.query(api.messages.listQueued, {
        sessionId,
        chatroomId,
      });
      expect(queuedMessages.length).toBe(1);
      expect(queuedMessages[0]?.content).toBe('Second task');
    });

    test('completing first task auto-promotes queued message', async () => {
      const { sessionId } = await createTestSession('test-fsm-move-pur-queued');
      const chatroomId = await createPairTeamChatroom(sessionId);
      await joinParticipants(sessionId, chatroomId, ['builder', 'reviewer']);

      // First message creates pending task
      await t.mutation(api.messages.sendMessage, {
        sessionId,
        chatroomId,
        content: 'First task',
        senderRole: 'user',
        type: 'message',
      });

      // Second message gets queued
      await t.mutation(api.messages.sendMessage, {
        sessionId,
        chatroomId,
        content: 'Second task',
        senderRole: 'user',
        type: 'message',
      });

      // Verify second is queued
      const queuedBefore = await t.query(api.messages.listQueued, { sessionId, chatroomId });
      expect(queuedBefore.length).toBe(1);

      // Complete first task — should auto-promote second
      await t.mutation(api.tasks.claimTask, { sessionId, chatroomId, role: 'builder' });
      await t.mutation(api.tasks.startTask, { sessionId, chatroomId, role: 'builder' });
      await t.mutation(api.tasks.completeTask, { sessionId, chatroomId, role: 'builder' });

      // Queue should now be empty
      const queuedAfter = await t.query(api.messages.listQueued, { sessionId, chatroomId });
      expect(queuedAfter.length).toBe(0);

      // Second task should now be pending
      const pendingTasks = await t.query(api.tasks.listTasks, {
        sessionId,
        chatroomId,
        statusFilter: 'pending',
      });
      expect(pendingTasks.length).toBe(1);
      expect(pendingTasks[0]?.status).toBe('pending');
    });

    test('promoteNextTask promotes queued message to pending task', async () => {
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

      // Create second message (will go to chatroom_messageQueue, no task yet)
      await t.mutation(api.messages.sendMessage, {
        sessionId,
        chatroomId,
        content: 'Second task',
        senderRole: 'user',
        type: 'message',
      });

      // Verify second message is in queue (not a task)
      const queuedMessages = await t.query(api.messages.listQueued, {
        sessionId,
        chatroomId,
      });
      expect(queuedMessages.length).toBe(1);
      expect(queuedMessages[0]?.content).toBe('Second task');

      // Complete first task (should auto-promote second message from queue)
      await t.mutation(api.tasks.claimTask, { sessionId, chatroomId, role: 'builder' });
      await t.mutation(api.tasks.startTask, { sessionId, chatroomId, role: 'builder' });
      await t.mutation(api.tasks.completeTask, {
        sessionId,
        chatroomId,
        role: 'builder',
      });

      // Queue should now be empty
      const queuedAfter = await t.query(api.messages.listQueued, {
        sessionId,
        chatroomId,
      });
      expect(queuedAfter.length).toBe(0);

      // A new pending task should have been created from the queued message
      const pendingTasks = await t.query(api.tasks.listTasks, {
        sessionId,
        chatroomId,
        statusFilter: 'pending',
      });
      expect(pendingTasks.length).toBe(1);
      expect(pendingTasks[0]?.content).toBe('Second task');
    });
  });

  describe('Backlog Actions', () => {
    test('backlog item can be marked for review via markBacklogItemForReview', async () => {
      const { sessionId } = await createTestSession('test-fsm-send-back');
      const chatroomId = await createPairTeamChatroom(sessionId);
      await joinParticipants(sessionId, chatroomId, ['builder', 'reviewer']);

      // Create a backlog item
      const backlogItemId = await t.mutation(api.backlog.createBacklogItem, {
        sessionId,
        chatroomId,
        content: 'Task to mark for review',
        createdBy: 'user',
      });

      // Mark for review: backlog → pending_user_review
      const markResult = await t.mutation(api.backlog.markBacklogItemForReview, {
        sessionId,
        itemId: backlogItemId,
      });
      expect(markResult.success).toBe(true);

      // Verify backlog item is now in pending_user_review
      const reviewItems = await t.query(api.backlog.listBacklogItems, {
        sessionId,
        chatroomId,
        statusFilter: 'pending_user_review',
      });
      const reviewItem = reviewItems.find((i) => i._id === backlogItemId);
      expect(reviewItem?.status).toBe('pending_user_review');

      // Send back for rework: pending_user_review → backlog
      const sendBackResult = await t.mutation(api.backlog.sendBacklogItemBackForRework, {
        sessionId,
        itemId: backlogItemId,
      });
      expect(sendBackResult.success).toBe(true);

      // Verify it's back in backlog
      const backlogItems = await t.query(api.backlog.listBacklogItems, {
        sessionId,
        chatroomId,
        statusFilter: 'backlog',
      });
      const backlogItem = backlogItems.find((i) => i._id === backlogItemId);
      expect(backlogItem?.status).toBe('backlog');
    });

    test('backlog item can be completed via completeBacklogItem', async () => {
      const { sessionId } = await createTestSession('test-fsm-mark-complete');
      const chatroomId = await createPairTeamChatroom(sessionId);
      await joinParticipants(sessionId, chatroomId, ['builder', 'reviewer']);

      // Create a backlog item
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
      const completeResult = await t.mutation(api.backlog.completeBacklogItem, {
        sessionId,
        itemId: backlogItemId,
      });
      expect(completeResult.success).toBe(true);

      // Verify item is now closed
      const closedItems = await t.query(api.backlog.listBacklogItems, {
        sessionId,
        chatroomId,
        statusFilter: 'closed',
      });
      const closedItem = closedItems.find((i) => i._id === backlogItemId);
      expect(closedItem?.status).toBe('closed');
      expect(closedItem?.completedAt).toBeDefined();
    });

    test('backlog item can be closed via closeBacklogItem', async () => {
      const { sessionId } = await createTestSession('test-fsm-close-backlog');
      const chatroomId = await createPairTeamChatroom(sessionId);
      await joinParticipants(sessionId, chatroomId, ['builder', 'reviewer']);

      // Create backlog item
      const backlogItemId = await t.mutation(api.backlog.createBacklogItem, {
        sessionId,
        chatroomId,
        content: 'Task to close',
        createdBy: 'user',
      });

      // Close it directly from backlog status
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
      const closedItem = closedItems.find((i) => i._id === backlogItemId);
      expect(closedItem?.status).toBe('closed');
    });

    test('closed backlog item can be reopened via reopenBacklogItem', async () => {
      const { sessionId } = await createTestSession('test-fsm-reopen-backlog');
      const chatroomId = await createPairTeamChatroom(sessionId);
      await joinParticipants(sessionId, chatroomId, ['builder', 'reviewer']);

      // Create and close a backlog item
      const backlogItemId = await t.mutation(api.backlog.createBacklogItem, {
        sessionId,
        chatroomId,
        content: 'Task to reopen',
        createdBy: 'user',
      });

      await t.mutation(api.backlog.closeBacklogItem, {
        sessionId,
        itemId: backlogItemId,
      });

      // Reopen the item: closed → backlog
      const reopenResult = await t.mutation(api.backlog.reopenBacklogItem, {
        sessionId,
        itemId: backlogItemId,
      });
      expect(reopenResult.success).toBe(true);

      // Verify item is back in backlog
      const backlogItems = await t.query(api.backlog.listBacklogItems, {
        sessionId,
        chatroomId,
        statusFilter: 'backlog',
      });
      const reopenedItem = backlogItems.find((i) => i._id === backlogItemId);
      expect(reopenedItem?.status).toBe('backlog');
      expect(reopenedItem?.completedAt).toBeUndefined();
    });
  });

  describe('Cancellation and Reset', () => {
    test('completeTaskById force-completes a pending task', async () => {
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

      // Force-complete the task as a way to remove it
      const completeResult = await t.mutation(api.tasks.completeTaskById, {
        sessionId,
        taskId: taskId as Id<'chatroom_tasks'>,
        force: true,
      });

      expect(completeResult.success).toBe(true);

      // Verify task is completed
      const archivedTasks = await t.query(api.tasks.listHistoricalTasks, {
        sessionId,
        chatroomId,
      });
      const completedTask = archivedTasks.find((t) => t._id === taskId);
      expect(completedTask?.status).toBe('completed');
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
      const archivedTasks = await t.query(api.tasks.listHistoricalTasks, {
        sessionId,
        chatroomId,
      });
      const completedTask = archivedTasks.find((t) => t._id === taskId);
      expect(completedTask?.status).toBe('completed');
      expect(completedTask?.completedAt).toBeDefined();
    });
  });
});

describe('FSM Error Handling', () => {
  test('FSM rejects invalid state transitions with clear error messages', async () => {
    const { sessionId } = await createTestSession('test-fsm-invalid-transition');
    const chatroomId = await createPairTeamChatroom(sessionId);
    await joinParticipants(sessionId, chatroomId, ['builder', 'reviewer']);

    // Create a backlog item
    const backlogItemId = await t.mutation(api.backlog.createBacklogItem, {
      sessionId,
      chatroomId,
      content: 'Backlog item for invalid transition test',
      createdBy: 'user',
    });

    // Try to reopen a backlog item that is not closed (should fail)
    await expect(
      t.mutation(api.backlog.reopenBacklogItem, {
        sessionId,
        itemId: backlogItemId,
      })
    ).rejects.toThrow(); // Cannot reopen a non-closed item

    // Try to start a task that's not acknowledged (should fail)
    await expect(
      t.mutation(api.tasks.startTask, {
        sessionId,
        chatroomId,
        role: 'builder',
      })
    ).rejects.toThrow(); // No acknowledged task exists
  });
});
