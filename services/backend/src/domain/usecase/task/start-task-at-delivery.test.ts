import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { recordTaskDelivery } from './record-task-delivery';
import { startTaskAtDelivery } from './start-task-at-delivery';
import { api } from '../../../../convex/_generated/api';
import { t } from '../../../../test.setup';

describe('startTaskAtDelivery', () => {
  test('starts an acknowledged task and its open receipt, idempotently', async () => {
    const sessionId = 'start-at-delivery' as SessionId;
    await t.mutation(api.auth.loginAnon, { sessionId });
    const chatroomId = await t.mutation(api.chatrooms.create, {
      sessionId,
      teamId: 'duo',
      teamName: 'Duo Team',
      teamRoles: ['planner', 'builder'],
      teamEntryPoint: 'builder',
    });
    const taskId = await t.run(async (ctx) => {
      const now = Date.now();
      return ctx.db.insert('chatroom_tasks', {
        chatroomId,
        createdBy: 'user',
        content: 'delivery task',
        status: 'acknowledged',
        assignedTo: 'builder',
        createdAt: now,
        updatedAt: now,
        queuePosition: 0,
      });
    });
    const receiptId = await t.run((ctx) =>
      recordTaskDelivery(ctx, {
        chatroomId,
        taskId,
        role: 'builder',
        deliveryKind: 'cli_get_next_task',
      })
    );

    await t.run((ctx) => startTaskAtDelivery(ctx, { chatroomId, role: 'builder', taskId }));
    await t.run((ctx) => startTaskAtDelivery(ctx, { chatroomId, role: 'builder', taskId }));

    const task = await t.run((ctx) => ctx.db.get('chatroom_tasks', taskId));
    const receipt = await t.run((ctx) => ctx.db.get('chatroom_taskDeliveryReceipts', receiptId));
    expect(task?.status).toBe('in_progress');
    expect(receipt?.startedAt).toBeTypeOf('number');
  });
});
