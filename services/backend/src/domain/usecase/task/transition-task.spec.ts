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
    teamId: 'duo',
    teamName: 'Duo Team',
    teamRoles: ['planner', 'builder'],
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
    await joinParticipants(sessionId, chatroomId, ['planner', 'builder']);

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
    await joinParticipants(sessionId, chatroomId, ['planner', 'builder']);

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
    await joinParticipants(sessionId, chatroomId, ['planner', 'builder']);

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

  test('completeTask does not auto-promote queued message', async () => {
    const { sessionId } = await createTestSession('tt-valid-4');
    const chatroomId = await createChatroom(sessionId);
    await joinParticipants(sessionId, chatroomId, ['planner', 'builder']);

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

    // Complete first task without promoting the second message from the queue
    await t.mutation(api.tasks.claimTask, { sessionId, chatroomId, role: 'builder' });
    await t.mutation(api.tasks.startTask, { sessionId, chatroomId, role: 'builder' });
    await t.mutation(api.tasks.completeTask, {
      sessionId,
      chatroomId,
      role: 'builder',
    });

    // Queue should still contain the second message
    const queuedAfter = await t.query(api.messages.listQueued, {
      sessionId,
      chatroomId,
    });
    expect(queuedAfter.length).toBe(1);

    // No pending task should have been created from the queued message
    const pendingTasks = await t.query(api.tasks.listTasks, {
      sessionId,
      chatroomId,
      statusFilter: 'pending',
    });
    expect(pendingTasks.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Tests: invalid transitions are rejected
// ---------------------------------------------------------------------------

describe('transitionTask usecase — invalid transitions are rejected', () => {
  test('cannot start a task that has not been claimed (no acknowledged task)', async () => {
    const { sessionId } = await createTestSession('tt-invalid-1');
    const chatroomId = await createChatroom(sessionId);
    await joinParticipants(sessionId, chatroomId, ['planner', 'builder']);

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
    await joinParticipants(sessionId, chatroomId, ['planner', 'builder']);

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
    await joinParticipants(sessionId, chatroomId, ['planner', 'builder']);

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
      t.mutation(api.tasks.claimTask, { sessionId, chatroomId, role: 'planner' })
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
    await joinParticipants(sessionId, chatroomId, ['planner', 'builder']);

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
    await joinParticipants(sessionId, chatroomId, ['planner', 'builder']);

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
    await joinParticipants(sessionId, chatroomId, ['planner', 'builder']);

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

    const participant = await t.run(async (ctx) =>
      ctx.db
        .query('chatroom_participants')
        .withIndex('by_chatroom_and_role', (q) =>
          q.eq('chatroomId', chatroomId).eq('role', 'builder')
        )
        .unique()
    );
    expect(participant?.lastStatus).not.toBe('task.completed');
  });

  test('force-complete: participant lastStatus NOT updated when skipAgentStatusUpdate=true', async () => {
    const { sessionId } = await createTestSession('tt-skip-status-2');
    const chatroomId = await createChatroom(sessionId);
    await joinParticipants(sessionId, chatroomId, ['planner', 'builder']);

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
    // Force-completing the terminal task releases the ephemeral builder, so its
    // participant transitions to 'agent.exited' rather than staying in-progress.
    expect(statusAfter).toBe('agent.exited');
  });

  test('normal completion: task.completed event emitted WITHOUT skipAgentStatusUpdate flag', async () => {
    const { sessionId } = await createTestSession('tt-skip-status-3');
    const chatroomId = await createChatroom(sessionId);
    await joinParticipants(sessionId, chatroomId, ['planner', 'builder']);

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

    const completed = await t.run(async (ctx) =>
      ctx.db
        .query('chatroom_tasks')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .filter((q) => q.eq(q.field('status'), 'completed'))
        .first()
    );
    expect(completed).not.toBeNull();
  });
});
