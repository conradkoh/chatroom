/**
 * Unit tests for the transitionTask usecase
 *
 * Tests FSM enforcement:
 * - Valid state transitions succeed and update the DB correctly
 * - Invalid transitions throw InvalidTransitionError
 * - Required fields are validated before transition
 * - clearFields are applied on transition
 * - Trigger label is used to select the correct rule
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { api } from '../../../../convex/_generated/api';
import type { Id } from '../../../../convex/_generated/dataModel';
import { t } from '../../../../test.setup';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createTestSession(id: string) {
  const login = await t.mutation(api.auth.loginAnon, { sessionId: id as SessionId });
  expect(login.success).toBe(true);
  return { sessionId: id as SessionId };
}

async function createChatroom(sessionId: SessionId): Promise<Id<'chatroom_rooms'>> {
  return await t.mutation(api.chatrooms.create, {
    sessionId,
    teamId: 'pair',
    teamName: 'Pair Team',
    teamRoles: ['builder', 'reviewer'],
    teamEntryPoint: 'builder',
  });
}

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

// ---------------------------------------------------------------------------
// Tests: valid transitions succeed
// ---------------------------------------------------------------------------

describe('transitionTask usecase — valid transitions', () => {
  test('pending → acknowledged via claimTask (sets acknowledgedAt + assignedTo)', async () => {
    const { sessionId } = await createTestSession('tt-valid-1');
    const chatroomId = await createChatroom(sessionId);
    await joinParticipants(sessionId, chatroomId, ['builder', 'reviewer']);

    // Create a pending task via sendMessage
    await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      content: 'Test task',
      senderRole: 'user',
      type: 'message',
    });

    // Claim transitions pending → acknowledged
    const result = await t.mutation(api.tasks.claimTask, {
      sessionId,
      chatroomId,
      role: 'builder',
    });
    expect(result.taskId).toBeDefined();

    const tasks = await t.query(api.tasks.listTasks, { sessionId, chatroomId, limit: 100 });
    const task = tasks.find((t) => t._id === result.taskId);
    expect(task?.status).toBe('acknowledged');
    expect(task?.assignedTo).toBe('builder');
    expect(task?.acknowledgedAt).toBeDefined();
    expect(task?.startedAt).toBeUndefined(); // not started yet
  });

  test('acknowledged → in_progress via startTask (sets startedAt)', async () => {
    const { sessionId } = await createTestSession('tt-valid-2');
    const chatroomId = await createChatroom(sessionId);
    await joinParticipants(sessionId, chatroomId, ['builder', 'reviewer']);

    await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      content: 'Test task',
      senderRole: 'user',
      type: 'message',
    });

    await t.mutation(api.tasks.claimTask, { sessionId, chatroomId, role: 'builder' });
    const startResult = await t.mutation(api.tasks.startTask, {
      sessionId,
      chatroomId,
      role: 'builder',
    });
    expect(startResult.taskId).toBeDefined();

    const tasks = await t.query(api.tasks.listTasks, { sessionId, chatroomId, limit: 100 });
    const task = tasks.find((t) => t._id === startResult.taskId);
    expect(task?.status).toBe('in_progress');
    expect(task?.startedAt).toBeDefined();
  });

  test('in_progress → completed via completeTask (sets completedAt)', async () => {
    const { sessionId } = await createTestSession('tt-valid-3');
    const chatroomId = await createChatroom(sessionId);
    await joinParticipants(sessionId, chatroomId, ['builder', 'reviewer']);

    await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      content: 'Test task',
      senderRole: 'user',
      type: 'message',
    });

    const claimResult = await t.mutation(api.tasks.claimTask, {
      sessionId,
      chatroomId,
      role: 'builder',
    });
    const taskId = claimResult.taskId;
    await t.mutation(api.tasks.startTask, { sessionId, chatroomId, role: 'builder' });
    const completeResult = await t.mutation(api.tasks.completeTask, {
      sessionId,
      chatroomId,
      role: 'builder',
    });
    expect(completeResult.completed).toBe(true);

    const tasks = await t.query(api.tasks.listHistoricalTasks, {
      sessionId,
      chatroomId,
      // no statusFilter needed - listHistoricalTasks returns completed+closed by default
    });
    const task = tasks.find((t) => t._id === taskId);
    expect(task?.status).toBe('completed');
    expect(task?.completedAt).toBeDefined();
  });

  test('queued message → pending task via auto-promotion after task completes', async () => {
    const { sessionId } = await createTestSession('tt-valid-4');
    const chatroomId = await createChatroom(sessionId);
    await joinParticipants(sessionId, chatroomId, ['builder', 'reviewer']);

    // First task blocks queue
    await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      content: 'First task',
      senderRole: 'user',
      type: 'message',
    });

    // Second message goes to queue (no task created yet)
    await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      content: 'Second task (queued)',
      senderRole: 'user',
      type: 'message',
    });

    // Verify second message is in chatroom_messageQueue, not as a task
    const queuedMessages = await t.query(api.messages.listQueued, {
      sessionId,
      chatroomId,
    });
    expect(queuedMessages.length).toBe(1);
    expect(queuedMessages[0]?.content).toBe('Second task (queued)');

    // Complete first task → auto-promotes second message from queue
    await t.mutation(api.tasks.claimTask, { sessionId, chatroomId, role: 'builder' });
    await t.mutation(api.tasks.startTask, { sessionId, chatroomId, role: 'builder' });
    await t.mutation(api.tasks.completeTask, {
      sessionId,
      chatroomId,
      role: 'builder',
    });

    // Queue should now be empty (message was promoted)
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
    expect(pendingTasks[0]?.content).toBe('Second task (queued)');
    expect(pendingTasks[0]?.status).toBe('pending');
  });
});

// ---------------------------------------------------------------------------
// Tests: invalid transitions are rejected
// ---------------------------------------------------------------------------

describe('transitionTask usecase — invalid transitions are rejected', () => {
  test('cannot start a task that has not been claimed (no acknowledged task)', async () => {
    const { sessionId } = await createTestSession('tt-invalid-1');
    const chatroomId = await createChatroom(sessionId);
    await joinParticipants(sessionId, chatroomId, ['builder', 'reviewer']);

    await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      content: 'Test task',
      senderRole: 'user',
      type: 'message',
    });

    // Attempt startTask without claimTask first — no acknowledged task exists
    await expect(
      t.mutation(api.tasks.startTask, { sessionId, chatroomId, role: 'builder' })
    ).rejects.toThrow();
  });

  test('cannot complete a task that is still pending (must be in_progress)', async () => {
    const { sessionId } = await createTestSession('tt-invalid-2');
    const chatroomId = await createChatroom(sessionId);
    await joinParticipants(sessionId, chatroomId, ['builder', 'reviewer']);

    await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      content: 'Test task',
      senderRole: 'user',
      type: 'message',
    });

    // Attempt completeTask without claim+start — no in_progress task
    // completeTask gracefully returns { completed: false } when no in_progress task is found
    const result = await t.mutation(api.tasks.completeTask, {
      sessionId,
      chatroomId,
      role: 'builder',
    });
    expect(result.completed).toBe(false);

    // Verify the task is still pending (not transitioned)
    const tasks = await t.query(api.tasks.listTasks, {
      sessionId,
      chatroomId,
      statusFilter: 'pending',
    });
    expect(tasks.length).toBe(1);
    expect(tasks[0]?.status).toBe('pending');
  });

  test('cannot claim a task twice (second claim finds no pending tasks)', async () => {
    const { sessionId } = await createTestSession('tt-invalid-3');
    const chatroomId = await createChatroom(sessionId);
    await joinParticipants(sessionId, chatroomId, ['builder', 'reviewer']);

    await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      content: 'Test task',
      senderRole: 'user',
      type: 'message',
    });

    // First claim succeeds
    await t.mutation(api.tasks.claimTask, { sessionId, chatroomId, role: 'builder' });

    // Second claim should fail — task is no longer pending
    await expect(
      t.mutation(api.tasks.claimTask, { sessionId, chatroomId, role: 'reviewer' })
    ).rejects.toThrow('No pending task to claim');
  });
});

// ---------------------------------------------------------------------------
// Tests: trigger label correctness
// ---------------------------------------------------------------------------

describe('transitionTask usecase — trigger label determines the rule', () => {
  test('backlog item can be closed via closeBacklogItem', async () => {
    const { sessionId } = await createTestSession('tt-trigger-1');
    const chatroomId = await createChatroom(sessionId);
    await joinParticipants(sessionId, chatroomId, ['builder', 'reviewer']);

    // Create a backlog item using the new chatroom_backlog API
    const backlogItemId = await t.mutation(api.backlog.createBacklogItem, {
      sessionId,
      chatroomId,
      content: 'Backlog item',
      createdBy: 'user',
    });
    expect(backlogItemId).toBeDefined();

    // Verify it's in backlog status
    const items = await t.query(api.backlog.listBacklogItems, {
      sessionId,
      chatroomId,
      statusFilter: 'backlog',
    });
    const item = items.find((i) => i._id === backlogItemId);
    expect(item?.status).toBe('backlog');

    // closeBacklogItem: backlog → closed
    const result = await t.mutation(api.backlog.closeBacklogItem, {
      sessionId,
      chatroomId,
      itemId: backlogItemId,
      reason: 'Test: transition task close',
    });
    expect(result.success).toBe(true);

    // Verify item is now closed
    const closedItems = await t.query(api.backlog.listBacklogItems, {
      sessionId,
      chatroomId,
      statusFilter: 'closed',
    });
    const closed = closedItems.find((i) => i._id === backlogItemId);
    expect(closed?.status).toBe('closed');
  });

  test('pending_user_review backlog item can be reopened via reopenBacklogItem', async () => {
    const { sessionId } = await createTestSession('tt-trigger-2');
    const chatroomId = await createChatroom(sessionId);
    await joinParticipants(sessionId, chatroomId, ['builder', 'reviewer']);

    // Create a backlog item using the new chatroom_backlog API
    const backlogItemId = await t.mutation(api.backlog.createBacklogItem, {
      sessionId,
      chatroomId,
      content: 'Backlog to reopen',
      createdBy: 'user',
    });

    // Transition: backlog → pending_user_review → closed → backlog (reopen)
    await t.mutation(api.backlog.markBacklogItemForReview, {
      sessionId,
      chatroomId,
      itemId: backlogItemId,
    });

    // Verify it's in pending_user_review
    const reviewItems = await t.query(api.backlog.listBacklogItems, {
      sessionId,
      chatroomId,
      statusFilter: 'pending_user_review',
    });
    const reviewItem = reviewItems.find((i) => i._id === backlogItemId);
    expect(reviewItem?.status).toBe('pending_user_review');

    // Close it first (reopenBacklogItem requires closed status)
    await t.mutation(api.backlog.closeBacklogItem, {
      sessionId,
      chatroomId,
      itemId: backlogItemId,
      reason: 'Test: close before reopen test',
    });

    // Now reopen: closed → backlog
    const reopenResult = await t.mutation(api.backlog.reopenBacklogItem, {
      sessionId,
      chatroomId,
      itemId: backlogItemId,
    });
    expect(reopenResult.success).toBe(true);

    // Verify it's back in backlog status
    const backlogItems = await t.query(api.backlog.listBacklogItems, {
      sessionId,
      chatroomId,
      statusFilter: 'backlog',
    });
    const reopened = backlogItems.find((i) => i._id === backlogItemId);
    expect(reopened?.status).toBe('backlog');
  });
});

// ---------------------------------------------------------------------------
// Tests: skipAgentStatusUpdate option (force-complete path)
// ---------------------------------------------------------------------------

describe('transitionTask — skipAgentStatusUpdate option', () => {
  test('force-complete: task.completed event IS emitted with skipAgentStatusUpdate=true flag', async () => {
    const { sessionId } = await createTestSession('tt-skip-status-1');
    const chatroomId = await createChatroom(sessionId);
    await joinParticipants(sessionId, chatroomId, ['builder', 'reviewer']);

    // Create and start a task
    await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      content: 'Task to force-complete',
      senderRole: 'user',
      type: 'message',
    });

    const claimResult = await t.mutation(api.tasks.claimTask, {
      sessionId,
      chatroomId,
      role: 'builder',
    });
    const taskId = claimResult.taskId;
    await t.mutation(api.tasks.startTask, { sessionId, chatroomId, role: 'builder' });

    // Force-complete the task (skipAgentStatusUpdate=true via completeTaskById)
    const result = await t.mutation(api.tasks.completeTaskById, {
      sessionId,
      taskId,
      force: true,
    });
    expect(result.success).toBe(true);
    expect(result.wasForced).toBe(true);

    // Verify task is completed
    const tasks = await t.query(api.tasks.listHistoricalTasks, {
      sessionId,
      chatroomId,
      // no statusFilter needed - listHistoricalTasks returns completed+closed by default
    });
    const task = tasks.find((t) => t._id === taskId);
    expect(task?.status).toBe('completed');

    // Verify task.completed event WAS emitted (always emitted — it's the authoritative record)
    // AND it carries skipAgentStatusUpdate: true so consumers know not to update agent status
    const eventsAfter = await t.run(async (ctx) => {
      return ctx.db
        .query('chatroom_eventStream')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .collect();
    });
    const taskCompletedEvents = eventsAfter.filter((e) => e.type === 'task.completed');
    expect(taskCompletedEvents.length).toBe(1);
    expect(
      (taskCompletedEvents[0] as { skipAgentStatusUpdate?: boolean }).skipAgentStatusUpdate
    ).toBe(true);
  });

  test('force-complete: participant lastStatus NOT updated when skipAgentStatusUpdate=true', async () => {
    const { sessionId } = await createTestSession('tt-skip-status-2');
    const chatroomId = await createChatroom(sessionId);
    await joinParticipants(sessionId, chatroomId, ['builder', 'reviewer']);

    // Create and start a task for builder
    await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      content: 'Task to force-complete',
      senderRole: 'user',
      type: 'message',
    });

    const claimResult = await t.mutation(api.tasks.claimTask, {
      sessionId,
      chatroomId,
      role: 'builder',
    });
    const taskId = claimResult.taskId;
    await t.mutation(api.tasks.startTask, { sessionId, chatroomId, role: 'builder' });

    // Get the builder's lastStatus before force-complete
    const statusBefore = await t.run(async (ctx) => {
      const participant = await ctx.db
        .query('chatroom_participants')
        .withIndex('by_chatroom_and_role', (q) =>
          q.eq('chatroomId', chatroomId).eq('role', 'builder')
        )
        .unique();
      return participant?.lastStatus ?? null;
    });

    // Force-complete
    await t.mutation(api.tasks.completeTaskById, {
      sessionId,
      taskId,
      force: true,
    });

    // Verify participant lastStatus was NOT changed to 'task.completed'
    const statusAfter = await t.run(async (ctx) => {
      const participant = await ctx.db
        .query('chatroom_participants')
        .withIndex('by_chatroom_and_role', (q) =>
          q.eq('chatroomId', chatroomId).eq('role', 'builder')
        )
        .unique();
      return participant?.lastStatus ?? null;
    });

    // lastStatus should not have been updated to 'task.completed'
    expect(statusAfter).not.toBe('task.completed');
    // It should be the same as before force-complete (or whatever startTask set it to)
    expect(statusAfter).toBe(statusBefore);
  });

  test('normal completion: task.completed event emitted WITHOUT skipAgentStatusUpdate flag', async () => {
    const { sessionId } = await createTestSession('tt-skip-status-3');
    const chatroomId = await createChatroom(sessionId);
    await joinParticipants(sessionId, chatroomId, ['builder', 'reviewer']);

    await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      content: 'Task to complete normally',
      senderRole: 'user',
      type: 'message',
    });

    await t.mutation(api.tasks.claimTask, { sessionId, chatroomId, role: 'builder' });
    await t.mutation(api.tasks.startTask, { sessionId, chatroomId, role: 'builder' });

    // Normal completion (not force)
    await t.mutation(api.tasks.completeTask, { sessionId, chatroomId, role: 'builder' });

    // task.completed event SHOULD be emitted for normal completion
    const events = await t.run(async (ctx) => {
      return ctx.db
        .query('chatroom_eventStream')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .collect();
    });
    const taskCompletedEvents = events.filter((e) => e.type === 'task.completed');
    expect(taskCompletedEvents.length).toBe(1);
    // Normal completion: skipAgentStatusUpdate should NOT be set
    expect(
      (taskCompletedEvents[0] as { skipAgentStatusUpdate?: boolean }).skipAgentStatusUpdate
    ).toBeUndefined();
  });
});
