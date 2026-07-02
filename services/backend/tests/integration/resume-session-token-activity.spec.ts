/**
 * Resume session token activity — Integration Tests
 *
 * Verifies updateTokenActivity restarts work when a resumed native agent is
 * agent.waiting and harness tokens resume.
 */

import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { t } from '../../test.setup';
import {
  createBuilderEntryDuoChatroom,
  createPlannerBuilderDuoChatroom,
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

async function setParticipantState(
  chatroomId: Id<'chatroom_rooms'>,
  role: string,
  patch: { lastStatus?: string; lastSeenAction?: string }
) {
  await t.run(async (ctx) => {
    const participant = await ctx.db
      .query('chatroom_participants')
      .withIndex('by_chatroom_and_role', (q) => q.eq('chatroomId', chatroomId).eq('role', role))
      .unique();
    if (participant) {
      await ctx.db.patch('chatroom_participants', participant._id, patch);
    }
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
    content: 'Resume session acknowledged task',
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

describe('Resume session token activity', () => {
  test('starts acknowledged task when participant is agent.waiting after resume', async () => {
    const { sessionId } = await createTestSession('test-resume-ack-waiting');
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

    await setParticipantState(chatroomId, 'builder', {
      lastStatus: 'agent.waiting',
      lastSeenAction: 'native:waiting',
    });

    await t.mutation(api.participants.updateTokenActivity, {
      sessionId,
      chatroomId,
      role: 'builder',
    });

    const status = await getParticipantStatus(chatroomId, 'builder');
    expect(status.lastStatus).toBe('task.inProgress');

    const task = await t.run(async (ctx) => ctx.db.get('chatroom_tasks', taskId));
    expect(task?.status).toBe('in_progress');
  });

  test('claims and starts pending task when participant is agent.waiting', async () => {
    const { sessionId } = await createTestSession('test-resume-pending-waiting');
    const chatroomId = await createPlannerBuilderDuoChatroom(sessionId);
    await joinParticipant(sessionId, chatroomId, 'planner');

    const { taskId } = await t.mutation(api.tasks.createTask, {
      sessionId,
      chatroomId,
      content: 'Resume session pending task',
      createdBy: 'user',
    });

    await t.run(async (ctx) => {
      await ctx.db.patch('chatroom_tasks', taskId, { assignedTo: 'planner' });
    });

    await setParticipantState(chatroomId, 'planner', {
      lastStatus: 'agent.waiting',
      lastSeenAction: 'native:waiting',
    });

    await t.mutation(api.participants.updateTokenActivity, {
      sessionId,
      chatroomId,
      role: 'planner',
    });

    const status = await getParticipantStatus(chatroomId, 'planner');
    expect(status.lastStatus).toBe('task.inProgress');

    const task = await t.run(async (ctx) => ctx.db.get('chatroom_tasks', taskId));
    expect(task?.status).toBe('in_progress');
    expect(task?.assignedTo).toBe('planner');
  });

  test('does not restart work when participant is agent.waiting but no tasks exist', async () => {
    const { sessionId } = await createTestSession('test-resume-no-tasks');
    const chatroomId = await createBuilderEntryDuoChatroom(sessionId);
    await joinParticipant(sessionId, chatroomId, 'builder');

    await setParticipantState(chatroomId, 'builder', {
      lastStatus: 'agent.waiting',
      lastSeenAction: 'native:waiting',
    });

    await t.mutation(api.participants.updateTokenActivity, {
      sessionId,
      chatroomId,
      role: 'builder',
    });

    const status = await getParticipantStatus(chatroomId, 'builder');
    expect(status.lastStatus).toBe('agent.waiting');
  });
});
