/**
 * claimTask idempotent re-claim integration tests.
 *
 * The backend no longer enforces the task FSM on claims: task-state
 * consistency is owned by the daemon. A task already `acknowledged` or
 * `in_progress` for the claiming role is returned unchanged instead of
 * throwing — the failure that caused the original enhancer delivery livelock.
 */

import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { t } from '../../test.setup';
import { createBuilderEntryDuoChatroom, createTestSession } from '../helpers/integration';

async function createAssignedTask(
  sessionId: string,
  chatroomId: Id<'chatroom_rooms'>,
  content: string,
  assignedTo: string
): Promise<Id<'chatroom_tasks'>> {
  const { taskId } = await t.mutation(api.tasks.createTask, {
    sessionId,
    chatroomId,
    content,
    createdBy: 'user',
  });
  await t.run((ctx) => ctx.db.patch('chatroom_tasks', taskId, { assignedTo }));
  return taskId;
}

describe('claimTask re-claims', () => {
  test('re-claiming an acknowledged task by its owner is idempotent', async () => {
    const { sessionId } = await createTestSession('claim-idem-1');
    const chatroomId = await createBuilderEntryDuoChatroom(sessionId);
    const taskId = await createAssignedTask(sessionId, chatroomId, 'Task A', 'builder');

    await t.mutation(api.tasks.claimTask, {
      sessionId,
      chatroomId,
      role: 'builder',
      taskId,
    });

    const result = await t.mutation(api.tasks.claimTask, {
      sessionId,
      chatroomId,
      role: 'builder',
      taskId,
    });

    expect(result.taskId).toBe(taskId);
    const task = await t.run((ctx) => ctx.db.get('chatroom_tasks', taskId));
    expect(task?.status).toBe('acknowledged');
  });

  test('re-claiming an in_progress task by its owner is idempotent', async () => {
    const { sessionId } = await createTestSession('claim-idem-2');
    const chatroomId = await createBuilderEntryDuoChatroom(sessionId);
    const taskId = await createAssignedTask(sessionId, chatroomId, 'Task B', 'builder');

    await t.mutation(api.tasks.claimTask, {
      sessionId,
      chatroomId,
      role: 'builder',
      taskId,
    });
    await t.mutation(api.tasks.startTask, {
      sessionId,
      chatroomId,
      role: 'builder',
      taskId,
    });

    const result = await t.mutation(api.tasks.claimTask, {
      sessionId,
      chatroomId,
      role: 'builder',
      taskId,
    });

    expect(result.taskId).toBe(taskId);
    const task = await t.run((ctx) => ctx.db.get('chatroom_tasks', taskId));
    expect(task?.status).toBe('in_progress');
  });

  test('a non-pending task assigned to another role is still rejected', async () => {
    const { sessionId } = await createTestSession('claim-idem-3');
    const chatroomId = await createBuilderEntryDuoChatroom(sessionId);
    const taskId = await createAssignedTask(sessionId, chatroomId, 'Task C', 'builder');

    await t.mutation(api.tasks.claimTask, {
      sessionId,
      chatroomId,
      role: 'builder',
      taskId,
    });

    await expect(
      t.mutation(api.tasks.claimTask, {
        sessionId,
        chatroomId,
        role: 'planner',
        taskId,
      })
    ).rejects.toThrow(/not claimable by role/i);
  });
});
