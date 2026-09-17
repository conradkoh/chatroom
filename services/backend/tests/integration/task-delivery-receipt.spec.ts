/**
 * Task delivery receipt integration tests.
 *
 * Receipt lifecycle is daemon-driven now: the daemon applies the read intent
 * (`api.tasks.readTask`, idempotent) and marks the open receipt started
 * (`api.taskDeliveryReceipts.markStarted`). The backend never infers state
 * from raw harness signals.
 */

import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import {
  findOpenDeliveryReceipt,
  recordTaskDelivery,
} from '../../src/domain/usecase/task/record-task-delivery';
import { t } from '../../test.setup';
import { createDuoTeamChatroom, createTestSession } from '../helpers/integration';

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

describe('task delivery receipt — daemon-driven lifecycle', () => {
  test('read intent moves the task to in_progress and markStarted closes the receipt', async () => {
    const { sessionId } = await createTestSession('tdr-receipt');
    const chatroomId = await createDuoTeamChatroom(sessionId);

    const taskId = await seedAcknowledgedTask(chatroomId, 'builder');

    // Open receipt from the native delivery
    await t.run(async (ctx) => {
      await recordTaskDelivery(ctx, {
        chatroomId,
        taskId,
        role: 'builder',
        deliveryKind: 'native_inject',
        harnessSessionId: 'sess-1',
      });
    });

    // Agent turn produces output → the daemon's task service applies the read intent
    await t.mutation(api.tasks.readTask, {
      sessionId,
      chatroomId,
      role: 'builder',
      taskId,
    });

    const task = await t.run(async (ctx) => ctx.db.get('chatroom_tasks', taskId));
    expect(task!.status).toBe('in_progress');

    // Mark the open receipt started (idempotent no-op once closed)
    const marked = await t.mutation(api.taskDeliveryReceipts.markStarted, {
      sessionId,
      chatroomId,
      role: 'builder',
      taskId,
    });
    expect(marked).toEqual({ marked: true });

    const receiptAfterStart = await t.run((ctx) =>
      findOpenDeliveryReceipt(ctx, chatroomId, 'builder', taskId)
    );
    expect(receiptAfterStart).toBeNull();

    const markedAgain = await t.mutation(api.taskDeliveryReceipts.markStarted, {
      sessionId,
      chatroomId,
      role: 'builder',
      taskId,
    });
    expect(markedAgain).toEqual({ marked: false });
  });

  test('markStarted without an open receipt is a no-op', async () => {
    const { sessionId } = await createTestSession('tdr-noop');
    const chatroomId = await createDuoTeamChatroom(sessionId);

    const taskId = await seedAcknowledgedTask(chatroomId, 'planner', 'task with no receipt');
    const result = await t.mutation(api.taskDeliveryReceipts.markStarted, {
      sessionId,
      chatroomId,
      role: 'planner',
      taskId,
    });
    expect(result).toEqual({ marked: false });
  });
});
