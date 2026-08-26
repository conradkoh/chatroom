/**
 * Task delivery receipt integration tests.
 *
 * Proves receipt rule starts task on updateTokenActivity,
 * and legacy path without receipt still works.
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

describe('task delivery receipt — receipt rule', () => {
  test('receipt + updateTokenActivity starts acknowledged task', async () => {
    const { sessionId } = await createTestSession('tdr-receipt');
    const chatroomId = await createDuoTeamChatroom(sessionId);
    await joinParticipant(sessionId, chatroomId, 'builder');

    const taskId = await seedAcknowledgedTask(chatroomId, 'builder');

    // Insert open receipt
    await t.run(async (ctx) => {
      await recordTaskDelivery(ctx, {
        chatroomId,
        taskId,
        role: 'builder',
        deliveryKind: 'native_inject',
        harnessSessionId: 'sess-1',
      });
    });

    // Call startTaskFromTokenActivity via updateTokenActivity mutation
    await t.mutation(api.participants.updateTokenActivity, {
      sessionId,
      chatroomId,
      role: 'builder',
    });

    const task = await t.run(async (ctx) => ctx.db.get('chatroom_tasks', taskId));
    expect(task!.status).toBe('in_progress');
  });

  test('legacy: acknowledged + native:task-injected without receipt -> in_progress', async () => {
    const { sessionId } = await createTestSession('tdr-legacy');
    const chatroomId = await createDuoTeamChatroom(sessionId);
    await joinParticipant(sessionId, chatroomId, 'builder');

    const taskId = await seedAcknowledgedTask(chatroomId, 'builder');

    // Join with native:task-injected to set participant state
    await t.mutation(api.participants.join, {
      sessionId,
      chatroomId,
      role: 'builder',
      action: 'native:task-injected',
      taskId,
    });

    // updateTokenActivity should start the task via legacy acknowledged-native rule
    await t.mutation(api.participants.updateTokenActivity, {
      sessionId,
      chatroomId,
      role: 'builder',
    });

    const task = await t.run(async (ctx) => ctx.db.get('chatroom_tasks', taskId));
    expect(task!.status).toBe('in_progress');
  });
});
