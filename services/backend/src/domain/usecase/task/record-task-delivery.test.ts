import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import {
  recordTaskDelivery,
  findOpenDeliveryReceipt,
  markDeliveryReceiptStarted,
} from './record-task-delivery';
import { api } from '../../../../convex/_generated/api';
import { t } from '../../../../test.setup';

async function createTestSession(id: string) {
  const login = await t.mutation(api.auth.loginAnon, { sessionId: id as SessionId });
  expect(login.success).toBe(true);
  return { sessionId: id as SessionId };
}

describe('recordTaskDelivery', () => {
  test('upserts open receipt and marks started', async () => {
    const { sessionId } = await createTestSession('tdr-unit');
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
        content: 'test',
        status: 'pending',
        assignedTo: 'builder',
        createdAt: now,
        updatedAt: now,
        queuePosition: 0,
      });
    });

    const receiptId = await t.run(async (ctx) =>
      recordTaskDelivery(ctx, {
        chatroomId,
        taskId,
        role: 'builder',
        deliveryKind: 'native_inject',
        harnessSessionId: 'sess-1',
      })
    );

    const found = await t.run(async (ctx) =>
      findOpenDeliveryReceipt(ctx, chatroomId, 'builder', taskId)
    );
    expect(found).not.toBeNull();
    expect(found!.deliveredAt).toBeGreaterThan(0);
    expect(found!.startedAt).toBeUndefined();

    await t.run(async (ctx) => markDeliveryReceiptStarted(ctx, receiptId));
    const updated = await t.run(async (ctx) =>
      findOpenDeliveryReceipt(ctx, chatroomId, 'builder', taskId)
    );
    expect(updated).toBeNull();

    const receipt = await t.run(async (ctx) => ctx.db.get(receiptId));
    expect(receipt!.startedAt).toBeGreaterThan(0);
  });
});
