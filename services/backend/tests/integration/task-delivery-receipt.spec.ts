/**
 * Task delivery receipt integration tests.
 *
 * Proves explicit delivery start via startTaskAtDelivery,
 * and that updateTokenActivity no longer transitions tasks.
 */

import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { recordTaskDelivery } from '../../src/domain/usecase/task/record-task-delivery';
import { t } from '../../test.setup';
import { createDuoTeamChatroom, createTestSession, joinParticipant } from '../helpers/integration';

async function seedAcknowledgedTask(
  chatroomId: Id<'chatroom_rooms'>,
  role: string,
  content = 'test task'
): Promise<Id<'chatroom_tasks'>> {
  return t.run(async (ctx) => {
    const now = Date.now();
    const taskId = await ctx.db.insert('chatroom_tasks', {
      chatroomId,
      createdBy: 'user',
      content,
      status: 'acknowledged',
      assignedTo: role,
      createdAt: now,
      updatedAt: now,
      queuePosition: 0,
    });
    return taskId;
  });
}

describe('task delivery receipt — explicit delivery start', () => {
  test('receipt + startTaskAtDelivery starts acknowledged task', async () => {
    const { sessionId } = await createTestSession('tdr-receipt');
    const chatroomId = await createDuoTeamChatroom(sessionId);
    await joinParticipant(sessionId, chatroomId, 'builder');

    const taskId = await seedAcknowledgedTask(chatroomId, 'builder');

    await t.run(async (ctx) => {
      await recordTaskDelivery(ctx, {
        chatroomId,
        taskId,
        role: 'builder',
        deliveryKind: 'native_inject',
        harnessSessionId: 'sess-1',
      });
    });

    await t.mutation(api.tasks.startTaskAtDelivery, {
      sessionId,
      chatroomId,
      role: 'builder',
      taskId,
    });

    const task = await t.run(async (ctx) => ctx.db.get('chatroom_tasks', taskId));
    expect(task!.status).toBe('in_progress');
  });

  test('startTaskAtDelivery starts acknowledged task without receipt', async () => {
    const { sessionId } = await createTestSession('tdr-no-receipt');
    const chatroomId = await createDuoTeamChatroom(sessionId);
    await joinParticipant(sessionId, chatroomId, 'builder');

    const taskId = await seedAcknowledgedTask(chatroomId, 'builder');

    await t.mutation(api.tasks.startTaskAtDelivery, {
      sessionId,
      chatroomId,
      role: 'builder',
      taskId,
    });

    const task = await t.run(async (ctx) => ctx.db.get('chatroom_tasks', taskId));
    expect(task!.status).toBe('in_progress');
  });

  test('updateTokenActivity does not start acknowledged task', async () => {
    const { sessionId } = await createTestSession('tdr-token-liveness');
    const chatroomId = await createDuoTeamChatroom(sessionId);
    await joinParticipant(sessionId, chatroomId, 'builder');

    const taskId = await seedAcknowledgedTask(chatroomId, 'builder');

    await t.mutation(api.participants.join, {
      sessionId,
      chatroomId,
      role: 'builder',
      action: 'native:task-injected',
      taskId,
    });

    await t.mutation(api.participants.updateTokenActivity, {
      sessionId,
      chatroomId,
      role: 'builder',
    });

    const task = await t.run(async (ctx) => ctx.db.get('chatroom_tasks', taskId));
    expect(task!.status).toBe('acknowledged');
  });
});
