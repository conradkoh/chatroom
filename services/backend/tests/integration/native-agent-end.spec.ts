/**
 * Native agent_end handler — Integration Tests
 *
 * Verifies handleNativeAgentEnd signals handoff reminder when active work
 * remains, transitions to waiting when idle, and is idempotent on repeat calls.
 */

import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { t } from '../../test.setup';
import {
  createBuilderEntryDuoChatroom,
  createTestSession,
  joinParticipant,
} from '../helpers/integration';

async function getParticipantStatus(chatroomId: Id<'chatroom_rooms'>, role: string) {
  return t.run(async (ctx) => {
    const p = await ctx.db
      .query('chatroom_participants')
      .withIndex('by_chatroom_and_role', (q) => q.eq('chatroomId', chatroomId).eq('role', role))
      .unique();
    return {
      lastStatus: p?.lastStatus ?? null,
      lastSeenAction: p?.lastSeenAction ?? null,
    };
  });
}

async function createAcknowledgedTask(
  sessionId: string,
  chatroomId: Id<'chatroom_rooms'>,
  role: string
) {
  const { taskId } = await t.mutation(api.tasks.createTask, {
    sessionId,
    chatroomId,
    content: 'Native agent_end reminder test task',
    createdBy: 'user',
  });

  await t.mutation(api.tasks.claimTask, {
    sessionId,
    chatroomId,
    role,
    taskId,
  });

  return taskId;
}

describe('Native agent_end handler', () => {
  test('returns needsHandoffReminder when acknowledged task active', async () => {
    const { sessionId } = await createTestSession('test-native-agent-end-reminder');
    const chatroomId = await createBuilderEntryDuoChatroom(sessionId);
    await joinParticipant(sessionId, chatroomId, 'builder');
    const taskId = await createAcknowledgedTask(sessionId, chatroomId, 'builder');

    await t.mutation(api.participants.join, {
      sessionId,
      chatroomId,
      role: 'builder',
      action: 'native:task-injected',
      taskId,
    });

    const result = await t.mutation(api.participants.handleNativeAgentEnd, {
      sessionId,
      chatroomId,
      role: 'builder',
    });

    expect(result).toEqual({
      needsHandoffReminder: true,
      transitionedToWaiting: false,
    });

    const task = await t.run(async (ctx) => ctx.db.get('chatroom_tasks', taskId));
    expect(task?.status).toBe('completed');

    const status = await getParticipantStatus(chatroomId, 'builder');
    expect(status.lastStatus).not.toBe('agent.waiting');
  });

  test('completes active task and promotes queued message while signaling handoff reminder', async () => {
    const { sessionId } = await createTestSession('test-native-agent-end-promote-queue');
    const chatroomId = await createBuilderEntryDuoChatroom(sessionId);
    await joinParticipant(sessionId, chatroomId, 'builder');
    const taskId = await createAcknowledgedTask(sessionId, chatroomId, 'builder');

    await t.mutation(api.participants.join, {
      sessionId,
      chatroomId,
      role: 'builder',
      action: 'native:task-injected',
      taskId,
    });

    let queuedMessageId: string | undefined;
    await t.run(async (ctx) => {
      queuedMessageId = (await ctx.db.insert('chatroom_messageQueue', {
        chatroomId,
        senderRole: 'user',
        targetRole: 'builder',
        content: 'Queued follow-up message',
        type: 'message',
        queuePosition: 1,
      })) as unknown as string;
    });

    const result = await t.mutation(api.participants.handleNativeAgentEnd, {
      sessionId,
      chatroomId,
      role: 'builder',
    });

    expect(result).toEqual({
      needsHandoffReminder: true,
      transitionedToWaiting: false,
    });

    const originalTask = await t.run(async (ctx) => ctx.db.get('chatroom_tasks', taskId));
    expect(originalTask?.status).toBe('completed');

    await t.run(async (ctx) => {
      const queueRecord = await ctx.db.get('chatroom_messageQueue', queuedMessageId as any);
      expect(queueRecord).toBeNull();

      const pendingTasks = await ctx.db
        .query('chatroom_tasks')
        .withIndex('by_chatroom_status', (q) =>
          q.eq('chatroomId', chatroomId).eq('status', 'pending')
        )
        .collect();
      expect(pendingTasks).toHaveLength(1);
      expect(pendingTasks[0]?.content).toBe('Queued follow-up message');
      expect(pendingTasks[0]?.assignedTo).toBe('builder');
    });
  });

  test('transitions to waiting when no active task', async () => {
    const { sessionId } = await createTestSession('test-native-agent-end-waiting');
    const chatroomId = await createBuilderEntryDuoChatroom(sessionId);
    await joinParticipant(sessionId, chatroomId, 'builder');

    let queuedMessageId: string | undefined;
    await t.run(async (ctx) => {
      queuedMessageId = (await ctx.db.insert('chatroom_messageQueue', {
        chatroomId,
        senderRole: 'user',
        targetRole: 'builder',
        content: 'Idle-path queued message',
        type: 'message',
        queuePosition: 1,
      })) as unknown as string;
    });

    const result = await t.mutation(api.participants.handleNativeAgentEnd, {
      sessionId,
      chatroomId,
      role: 'builder',
    });

    expect(result).toEqual({
      needsHandoffReminder: false,
      transitionedToWaiting: true,
    });

    const status = await getParticipantStatus(chatroomId, 'builder');
    expect(status.lastStatus).toBe('agent.waiting');
    expect(status.lastSeenAction).toBe('native:waiting');

    await t.run(async (ctx) => {
      const queueRecord = await ctx.db.get('chatroom_messageQueue', queuedMessageId as any);
      expect(queueRecord).toBeNull();

      const pendingTasks = await ctx.db
        .query('chatroom_tasks')
        .withIndex('by_chatroom_status', (q) =>
          q.eq('chatroomId', chatroomId).eq('status', 'pending')
        )
        .collect();
      expect(pendingTasks).toHaveLength(1);
      expect(pendingTasks[0]?.content).toBe('Idle-path queued message');
    });
  });

  test('is idempotent when already waiting', async () => {
    const { sessionId } = await createTestSession('test-native-agent-end-idempotent');
    const chatroomId = await createBuilderEntryDuoChatroom(sessionId);
    await joinParticipant(sessionId, chatroomId, 'builder');

    await t.mutation(api.participants.handleNativeAgentEnd, {
      sessionId,
      chatroomId,
      role: 'builder',
    });

    const eventsAfterFirst = await t.run(async (ctx) => {
      return ctx.db
        .query('chatroom_eventStream')
        .withIndex('by_chatroom_type', (q) =>
          q.eq('chatroomId', chatroomId).eq('type', 'agent.waiting')
        )
        .collect();
    });

    const second = await t.mutation(api.participants.handleNativeAgentEnd, {
      sessionId,
      chatroomId,
      role: 'builder',
    });

    expect(second).toEqual({
      needsHandoffReminder: false,
      transitionedToWaiting: false,
    });

    const eventsAfterSecond = await t.run(async (ctx) => {
      return ctx.db
        .query('chatroom_eventStream')
        .withIndex('by_chatroom_type', (q) =>
          q.eq('chatroomId', chatroomId).eq('type', 'agent.waiting')
        )
        .collect();
    });
    expect(eventsAfterSecond).toHaveLength(eventsAfterFirst.length);
  });
});
