/**
 * Queue Notice Sync Tests
 *
 * Tests that the "Queue has tasks but none active" notice condition
 * (needsPromotion) is accurate across various task lifecycle scenarios.
 *
 * The notice depends on task and queue occupancy. Participant lifecycle is
 * diagnostic only and does not gate explicit manual recovery.
 *
 * These tests verify that the backend data (counts + queue state) stays
 * in sync so the frontend notice doesn't show incorrectly.
 */

import { ACTIVE_QUEUE_TASK_STATUSES } from '@workspace/shared/domain/entities/work-queue';
import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { t } from '../../test.setup';
import {
  createTestSession,
  createBuilderEntryDuoChatroom,
  joinParticipant,
} from '../helpers/integration';

/**
 * Helper: Get task counts for a chatroom.
 */
async function getTaskCounts(sessionId: string, chatroomId: any) {
  return await t.query(api.tasks.getTaskCounts, {
    sessionId: sessionId as any,
    chatroomId,
  });
}

/**
 * Helper: Get actual queue record count (bypasses materialized counts).
 */
async function getActualQueueCount(chatroomId: any) {
  return await t.run(async (ctx) => {
    const records = await ctx.db
      .query('chatroom_messageQueue')
      .withIndex('by_chatroom', (q: any) => q.eq('chatroomId', chatroomId))
      .collect();
    return records.length;
  });
}

/**
 * Helper: Get materialized queue size (from chatroom_taskCounts).
 */
async function getMaterializedQueueSize(chatroomId: any) {
  return await t.run(async (ctx) => {
    const counts = await ctx.db
      .query('chatroom_taskCounts')
      .withIndex('by_chatroom', (q: any) => q.eq('chatroomId', chatroomId))
      .first();
    return counts?.queueSize ?? 0;
  });
}

async function getTask(taskId: Id<'chatroom_tasks'>) {
  return await t.run((ctx) => ctx.db.get('chatroom_tasks', taskId));
}

describe('Queue Notice Sync — getTaskCounts accuracy', () => {
  test('queued count is 0 when no messages are queued', async () => {
    const { sessionId } = await createTestSession('qns-1');
    const chatroomId = await createBuilderEntryDuoChatroom(sessionId);

    const counts = await getTaskCounts(sessionId, chatroomId);
    expect(counts.queued).toBe(0);
  });

  test('queued count matches actual queue records after sending messages while busy', async () => {
    const { sessionId } = await createTestSession('qns-2');
    const chatroomId = await createBuilderEntryDuoChatroom(sessionId);

    // Join builder (entry point) so promotion can happen
    await joinParticipant(sessionId as any, chatroomId, 'builder');

    // Send first message — should create a pending task (not queued)
    await t.mutation(api.messages.sendMessage, {
      sessionId: sessionId as any,
      chatroomId,
      senderRole: 'user',
      content: 'first message',
      type: 'message',
    });

    // Verify: 1 pending task, 0 queued
    let counts = await getTaskCounts(sessionId, chatroomId);
    expect(counts.pending).toBeGreaterThanOrEqual(1);
    expect(counts.queued).toBe(0);

    // Send second message while task is active — should be queued
    await t.mutation(api.messages.sendMessage, {
      sessionId: sessionId as any,
      chatroomId,
      senderRole: 'user',
      content: 'second message (should queue)',
      type: 'message',
    });

    // Verify: still 1 pending, 1 queued
    counts = await getTaskCounts(sessionId, chatroomId);
    expect(counts.pending).toBeGreaterThanOrEqual(1);
    expect(counts.queued).toBe(1);

    // Verify actual queue records match
    const actualCount = await getActualQueueCount(chatroomId);
    expect(actualCount).toBe(1);
  });

  test('getTaskCounts cross-checks queue: returns 0 if materialized says queued but queue is empty', async () => {
    const { sessionId } = await createTestSession('qns-3');
    const chatroomId = await createBuilderEntryDuoChatroom(sessionId);

    // Manually create a materialized count with stale queueSize > 0
    // (simulates counter drift)
    await t.run(async (ctx) => {
      await ctx.db.insert('chatroom_taskCounts', {
        chatroomId,
        pending: 0,
        acknowledged: 0,
        inProgress: 0,
        completed: 0,
        queueSize: 5, // Stale! No actual queue records exist
        backlogCount: 0,
        pendingReviewCount: 0,
      });
    });

    // getTaskCounts should cross-check and return 0 (not 5)
    const counts = await getTaskCounts(sessionId, chatroomId);
    expect(counts.queued).toBe(0);
  });

  test('getTaskCounts cross-checks queue: returns at least 1 if materialized says 0 but queue has records', async () => {
    const { sessionId } = await createTestSession('qns-4');
    const chatroomId = await createBuilderEntryDuoChatroom(sessionId);

    // Create a materialized count with queueSize = 0
    await t.run(async (ctx) => {
      await ctx.db.insert('chatroom_taskCounts', {
        chatroomId,
        pending: 0,
        acknowledged: 0,
        inProgress: 0,
        completed: 0,
        queueSize: 0, // Wrong — we'll add a queue record below
        backlogCount: 0,
        pendingReviewCount: 0,
      });

      // Manually insert a queue record
      await ctx.db.insert('chatroom_messageQueue', {
        chatroomId,
        senderRole: 'user',
        targetRole: 'builder',
        content: 'queued message',
        type: 'message',
        queuePosition: 1,
      });
    });

    // getTaskCounts should cross-check and return at least 1 (not 0)
    const counts = await getTaskCounts(sessionId, chatroomId);
    expect(counts.queued).toBeGreaterThanOrEqual(1);
  });

  test('queue count stays in sync after promotion cycle', async () => {
    const { sessionId } = await createTestSession('qns-5');
    const chatroomId = await createBuilderEntryDuoChatroom(sessionId);

    // Join builder
    await joinParticipant(sessionId as any, chatroomId, 'builder');

    // Send first message (becomes pending task)
    await t.mutation(api.messages.sendMessage, {
      sessionId: sessionId as any,
      chatroomId,
      senderRole: 'user',
      content: 'task 1',
      type: 'message',
    });

    // Send second message (queued)
    await t.mutation(api.messages.sendMessage, {
      sessionId: sessionId as any,
      chatroomId,
      senderRole: 'user',
      content: 'task 2 (queued)',
      type: 'message',
    });

    // Send third message (also queued)
    await t.mutation(api.messages.sendMessage, {
      sessionId: sessionId as any,
      chatroomId,
      senderRole: 'user',
      content: 'task 3 (queued)',
      type: 'message',
    });

    // Verify: 1 pending, 2 queued
    const counts = await getTaskCounts(sessionId, chatroomId);
    expect(counts.pending).toBeGreaterThanOrEqual(1);
    expect(counts.queued).toBe(2);

    // Verify actual queue matches materialized
    const actualCount = await getActualQueueCount(chatroomId);
    expect(actualCount).toBe(2);

    const materializedSize = await getMaterializedQueueSize(chatroomId);
    expect(materializedSize).toBe(2);
  });
});

describe('Queue Notice Sync — manual promotion recovery', () => {
  test('force completing an agent-origin task leaves queued work recoverable', async () => {
    const { sessionId } = await createTestSession('qns-recovery-agent');
    const chatroomId = await createBuilderEntryDuoChatroom(sessionId);
    const { taskId } = await t.mutation(api.tasks.createTask, {
      sessionId,
      chatroomId,
      createdBy: 'planner',
      content: 'agent-origin active task',
    });
    await t.mutation(api.messages.enqueueMessageAtFront, {
      sessionId,
      chatroomId,
      content: 'queued recovery message',
    });
    // An active participant that is not in the wait loop must not hide recovery.
    await joinParticipant(sessionId, chatroomId, 'builder');

    const completion = await t.mutation(api.tasks.completeTaskById, {
      sessionId,
      taskId,
      force: true,
    });
    expect(completion).toMatchObject({ success: true, taskId, wasForced: true });

    const counts = await getTaskCounts(sessionId, chatroomId);
    expect(counts).toMatchObject({ pending: 0, acknowledged: 0, in_progress: 0, queued: 1 });
    const health = await t.query(api.tasks.checkQueueHealth, { sessionId, chatroomId });
    expect(health).toMatchObject({
      hasActiveTask: false,
      allAgentsReady: false,
      needsPromotion: true,
    });

    const promoted = await t.mutation(api.tasks.promoteNextTask, { sessionId, chatroomId });
    expect(promoted.reason).toBe('success');
    expect(promoted.taskId).toBeTruthy();
    const promotedTask = await getTask(promoted.taskId as Id<'chatroom_tasks'>);
    expect(promotedTask).toMatchObject({ status: 'pending', content: 'queued recovery message' });
    expect(promotedTask?.sourceMessageId).toBeTruthy();
    expect((await getTask(taskId))?.status).toBe('completed');
    expect(await getActualQueueCount(chatroomId)).toBe(0);
    expect((await getTaskCounts(sessionId, chatroomId)).queued).toBe(0);

    const repeated = await t.mutation(api.tasks.promoteNextTask, { sessionId, chatroomId });
    expect(repeated).toMatchObject({ promoted: false, reason: 'active_task_exists', taskId: null });
    expect(
      (
        await t.query(api.tasks.listTasks, {
          sessionId,
          chatroomId,
          statusFilter: 'active',
          limit: 100,
        })
      ).filter((task) => task.status !== 'completed')
    ).toHaveLength(1);
  });

  test('force completing a user-origin task keeps its automatic promotion behavior', async () => {
    const { sessionId } = await createTestSession('qns-recovery-user');
    const chatroomId = await createBuilderEntryDuoChatroom(sessionId);
    const { taskId } = await t.mutation(api.tasks.createTask, {
      sessionId,
      chatroomId,
      createdBy: 'user',
      content: 'user-origin active task',
    });
    await t.mutation(api.messages.enqueueMessageAtFront, {
      sessionId,
      chatroomId,
      content: 'automatically promoted message',
    });

    await t.mutation(api.tasks.completeTaskById, { sessionId, taskId, force: true });

    const counts = await getTaskCounts(sessionId, chatroomId);
    expect(counts.pending).toBe(1);
    expect(counts.queued).toBe(0);
  });

  test.each(ACTIVE_QUEUE_TASK_STATUSES)('%s task blocks manual recovery', async (status) => {
    const { sessionId } = await createTestSession(`qns-recovery-${status}`);
    const chatroomId = await createBuilderEntryDuoChatroom(sessionId);
    const { taskId } = await t.mutation(api.tasks.createTask, {
      sessionId,
      chatroomId,
      createdBy: 'planner',
      content: `${status} task`,
    });
    if (status !== 'pending') {
      await t.mutation(api.tasks.claimTask, { sessionId, chatroomId, role: 'planner', taskId });
    }
    if (status === 'in_progress') {
      await t.mutation(api.tasks.readTask, { sessionId, chatroomId, role: 'planner', taskId });
    }
    await t.mutation(api.messages.enqueueMessageAtFront, {
      sessionId,
      chatroomId,
      content: 'blocked queued message',
    });

    expect(await t.query(api.tasks.checkQueueHealth, { sessionId, chatroomId })).toMatchObject({
      hasActiveTask: true,
      needsPromotion: false,
    });
    expect(await t.mutation(api.tasks.promoteNextTask, { sessionId, chatroomId })).toMatchObject({
      promoted: false,
      reason: 'active_task_exists',
    });
    expect((await getTaskCounts(sessionId, chatroomId)).queued).toBe(1);
  });

  test('remaining active work blocks recovery after a different task completes', async () => {
    const { sessionId } = await createTestSession('qns-recovery-remaining-active');
    const chatroomId = await createBuilderEntryDuoChatroom(sessionId);
    const taskToComplete = await t.mutation(api.tasks.createTask, {
      sessionId,
      chatroomId,
      createdBy: 'planner',
      content: 'task to complete',
    });
    const remainingTask = await t.mutation(api.tasks.createTask, {
      sessionId,
      chatroomId,
      createdBy: 'planner',
      content: 'remaining active task',
    });
    await t.mutation(api.messages.enqueueMessageAtFront, {
      sessionId,
      chatroomId,
      content: 'must stay queued',
    });

    await t.mutation(api.tasks.completeTaskById, {
      sessionId,
      taskId: taskToComplete.taskId,
      force: true,
    });

    expect((await getTask(taskToComplete.taskId))?.status).toBe('completed');
    expect((await getTask(remainingTask.taskId))?.status).toBe('pending');
    expect(await t.query(api.tasks.checkQueueHealth, { sessionId, chatroomId })).toMatchObject({
      hasActiveTask: true,
      needsPromotion: false,
    });
    expect(await t.mutation(api.tasks.promoteNextTask, { sessionId, chatroomId })).toMatchObject({
      promoted: false,
      reason: 'active_task_exists',
    });
    expect((await getTaskCounts(sessionId, chatroomId)).queued).toBe(1);
  });
});
