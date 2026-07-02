/**
 * Native agent_end handler — Integration Tests
 *
 * Verifies handleNativeAgentEnd completes active tasks, delivers buffered
 * assistant text, transitions to waiting, and is idempotent on repeat calls.
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
    content: 'Native agent_end fallback test task',
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
  test('completes acknowledged task and delivers buffered handoff message to user', async () => {
    const { sessionId } = await createTestSession('test-native-agent-end-fallback');
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
      bufferedContent: 'Work finished without explicit handoff.',
    });

    expect(result).toEqual({
      taskCompleted: true,
      messageDelivered: true,
      transitionedToWaiting: true,
    });

    const task = await t.run(async (ctx) => ctx.db.get('chatroom_tasks', taskId));
    expect(task?.status).toBe('completed');

    const messages = await t.run(async (ctx) => {
      return ctx.db
        .query('chatroom_messages')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .collect();
    });
    const handoff = messages.find(
      (m) => m.type === 'handoff' && m.targetRole === 'user' && m.senderRole === 'builder'
    );
    expect(handoff?.content).toBe('Work finished without explicit handoff.');

    const status = await getParticipantStatus(chatroomId, 'builder');
    expect(status.lastStatus).toBe('agent.waiting');
    expect(status.lastSeenAction).toBe('native:waiting');
  });

  test('is idempotent when called again while already waiting', async () => {
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
      bufferedContent: 'Should not duplicate on idle repeat.',
    });

    expect(second).toEqual({
      taskCompleted: false,
      messageDelivered: false,
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
