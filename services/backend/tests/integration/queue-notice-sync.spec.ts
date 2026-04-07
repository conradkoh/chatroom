/**
 * Queue Notice Sync Tests
 *
 * Tests that the "Queue has tasks but none active" notice condition
 * (needsPromotion) is accurate across various task lifecycle scenarios.
 *
 * The notice depends on:
 *   1. getTaskCounts — materialized or computed task/queue counts
 *   2. Participant lifecycle — agent lastSeenAction states
 *
 * These tests verify that the backend data (counts + queue state) stays
 * in sync so the frontend notice doesn't show incorrectly.
 */

import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import { t } from '../../test.setup';
import {
  createTestSession,
  createPairTeamChatroom,
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

describe('Queue Notice Sync — getTaskCounts accuracy', () => {
  test('queued count is 0 when no messages are queued', async () => {
    const { sessionId } = await createTestSession('qns-1');
    const chatroomId = await createPairTeamChatroom(sessionId);

    const counts = await getTaskCounts(sessionId, chatroomId);
    expect(counts.queued).toBe(0);
  });

  test('queued count matches actual queue records after sending messages while busy', async () => {
    const { sessionId } = await createTestSession('qns-2');
    const chatroomId = await createPairTeamChatroom(sessionId);

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
    const chatroomId = await createPairTeamChatroom(sessionId);

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
    const chatroomId = await createPairTeamChatroom(sessionId);

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
    const chatroomId = await createPairTeamChatroom(sessionId);

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
    let counts = await getTaskCounts(sessionId, chatroomId);
    expect(counts.pending).toBeGreaterThanOrEqual(1);
    expect(counts.queued).toBe(2);

    // Verify actual queue matches materialized
    let actualCount = await getActualQueueCount(chatroomId);
    expect(actualCount).toBe(2);

    let materializedSize = await getMaterializedQueueSize(chatroomId);
    expect(materializedSize).toBe(2);
  });
});
