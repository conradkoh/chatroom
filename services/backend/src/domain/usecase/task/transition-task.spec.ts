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
      action: 'wait-for-task:started',
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

    const tasks = await t.query(api.tasks.listTasks, {
      sessionId,
      chatroomId,
      statusFilter: 'archived',
    });
    const task = tasks.find((t) => t._id === taskId);
    expect(task?.status).toBe('completed');
    expect(task?.completedAt).toBeDefined();
  });

  test('queued → pending via promoteNextTask (clears stale fields)', async () => {
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

    // Second task goes to queued
    await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      content: 'Second task (queued)',
      senderRole: 'user',
      type: 'message',
    });

    let tasks = await t.query(api.tasks.listTasks, {
      sessionId,
      chatroomId,
      statusFilter: 'queued',
    });
    expect(tasks.length).toBe(1);
    const queuedTaskId = tasks[0]?._id as Id<'chatroom_tasks'>;

    // Complete first task → auto-promotes second
    await t.mutation(api.tasks.claimTask, { sessionId, chatroomId, role: 'builder' });
    await t.mutation(api.tasks.startTask, { sessionId, chatroomId, role: 'builder' });
    const completeResult = await t.mutation(api.tasks.completeTask, {
      sessionId,
      chatroomId,
      role: 'builder',
    });
    // `promoted` field was removed — promotion now happens implicitly inside transitionTask usecase.
    // Verify the queued task was actually promoted to pending instead.
    void completeResult;

    tasks = await t.query(api.tasks.listTasks, {
      sessionId,
      chatroomId,
      statusFilter: 'pending',
    });
    const promotedTask = tasks.find((t) => t._id === queuedTaskId);
    expect(promotedTask?.status).toBe('pending');
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
  test('backlog task can be cancelled via cancelTask trigger', async () => {
    const { sessionId } = await createTestSession('tt-trigger-1');
    const chatroomId = await createChatroom(sessionId);
    await joinParticipants(sessionId, chatroomId, ['builder', 'reviewer']);

    const backlogTask = await t.mutation(api.tasks.createTask, {
      sessionId,
      chatroomId,
      content: 'Backlog item',
      createdBy: 'user',
      isBacklog: true,
    });
    expect(backlogTask.status).toBe('backlog');

    // cancelTask trigger: backlog → closed
    const result = await t.mutation(api.tasks.closeBacklogTask, {
      sessionId,
      taskId: backlogTask.taskId,
    });
    expect(result.success).toBe(true);

    const tasks = await t.query(api.tasks.listTasks, {
      sessionId,
      chatroomId,
      statusFilter: 'archived',
    });
    const cancelled = tasks.find((t) => t._id === backlogTask.taskId);
    expect(cancelled?.status).toBe('closed');
  });

  test('pending_user_review task can be reopened via reopenBacklogTask trigger', async () => {
    const { sessionId } = await createTestSession('tt-trigger-2');
    const chatroomId = await createChatroom(sessionId);
    await joinParticipants(sessionId, chatroomId, ['builder', 'reviewer']);

    const backlogTask = await t.mutation(api.tasks.createTask, {
      sessionId,
      chatroomId,
      content: 'Backlog to reopen',
      createdBy: 'user',
      isBacklog: true,
    });

    // Move through workflow to completed
    await t.mutation(api.tasks.moveToQueue, { sessionId, taskId: backlogTask.taskId });
    await t.mutation(api.tasks.claimTask, { sessionId, chatroomId, role: 'builder' });
    await t.mutation(api.tasks.startTask, { sessionId, chatroomId, role: 'builder' });
    await t.mutation(api.tasks.completeTask, { sessionId, chatroomId, role: 'builder' });
    await t.mutation(api.tasks.markBacklogComplete, { sessionId, taskId: backlogTask.taskId });

    // Now reopen: completed → pending_user_review
    const reopenResult = await t.mutation(api.tasks.reopenBacklogTask, {
      sessionId,
      taskId: backlogTask.taskId,
    });
    expect(reopenResult.success).toBe(true);

    const tasks = await t.query(api.tasks.listTasks, {
      sessionId,
      chatroomId,
      statusFilter: 'pending_review',
    });
    const reopened = tasks.find((t) => t._id === backlogTask.taskId);
    expect(reopened?.status).toBe('pending_user_review');
    expect(reopened?.completedAt).toBeUndefined(); // cleared by FSM on reopen
  });
});
