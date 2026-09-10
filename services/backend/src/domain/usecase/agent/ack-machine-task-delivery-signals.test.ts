import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { ackMachineTaskDeliverySignals } from './ack-machine-task-delivery-signals';
import { api } from '../../../../convex/_generated/api';
import type { Id } from '../../../../convex/_generated/dataModel';
import { t } from '../../../../test.setup';
import { buildTaskStatusSignalKey } from '../../entities/machine-task-delivery-signal';

const now = 1_700_000_000_000;

async function setup(label: string) {
  const sessionId = `ack-delivery-${label}-${Math.random()}` as SessionId;
  await t.mutation(api.auth.loginAnon, { sessionId });
  const chatroomId = await t.mutation(api.chatrooms.create, {
    sessionId,
    teamId: 'duo',
    teamName: 'Duo',
    teamRoles: ['planner', 'builder'],
    teamEntryPoint: 'planner',
  });
  const otherChatroomId = await t.mutation(api.chatrooms.create, {
    sessionId,
    teamId: 'duo',
    teamName: 'Duo',
    teamRoles: ['planner', 'builder'],
    teamEntryPoint: 'planner',
  });
  return { chatroomId, otherChatroomId, machineId: `ack-delivery-machine-${label}`, sessionId };
}

async function insertDeliverySignal(
  machineId: string,
  chatroomId: Id<'chatroom_rooms'>,
  updatedAt: number,
  targetRole = 'builder'
): Promise<string> {
  return t.run(async (ctx) => {
    const taskId = await ctx.db.insert('chatroom_tasks', {
      chatroomId,
      createdBy: 'user',
      content: `delivery task ${updatedAt}`,
      status: 'pending',
      assignedTo: targetRole,
      createdAt: updatedAt,
      updatedAt,
      queuePosition: 0,
    });
    const signalKey = buildTaskStatusSignalKey(updatedAt, String(taskId));
    await ctx.db.insert('chatroom_machineTaskDeliverySignals', {
      machineId,
      chatroomId,
      taskId,
      targetRole,
      taskStatus: 'pending',
      signalKey,
      taskUpdatedAt: updatedAt,
    });
    return signalKey;
  });
}

async function remainingSignals(machineId: string, chatroomId: Id<'chatroom_rooms'>) {
  return t.run((ctx) =>
    ctx.db
      .query('chatroom_machineTaskDeliverySignals')
      .withIndex('by_machineId_chatroomId_signalKey', (q) =>
        q.eq('machineId', machineId).eq('chatroomId', chatroomId)
      )
      .collect()
  );
}

describe('ackMachineTaskDeliverySignals', () => {
  test('deletes rows through the key inclusively and preserves later rows', async () => {
    const { chatroomId, machineId } = await setup('range');
    const key0 = await insertDeliverySignal(machineId, chatroomId, now);
    const key1 = await insertDeliverySignal(machineId, chatroomId, now + 1);
    await insertDeliverySignal(machineId, chatroomId, now + 2);
    expect(key0 < key1).toBe(true);

    const result = await t.run((ctx) =>
      ackMachineTaskDeliverySignals(ctx, {
        machineId,
        chatroomId: String(chatroomId),
        throughSignalKey: key1,
      })
    );
    expect(result).toEqual({ deletedCount: 2, hasMore: false });
    const remaining = await remainingSignals(machineId, chatroomId);
    expect(remaining).toHaveLength(1);
  });

  test('preserves rows for another chatroom and another machine', async () => {
    const { chatroomId, otherChatroomId, machineId } = await setup('scope');
    const through = await insertDeliverySignal(machineId, chatroomId, now);
    await insertDeliverySignal(machineId, otherChatroomId, now);
    await insertDeliverySignal(`other-${machineId}`, chatroomId, now);

    const result = await t.run((ctx) =>
      ackMachineTaskDeliverySignals(ctx, {
        machineId,
        chatroomId: String(chatroomId),
        throughSignalKey: through,
      })
    );
    expect(result.deletedCount).toBe(1);
    expect(result.hasMore).toBe(false);
    expect(await remainingSignals(machineId, chatroomId)).toHaveLength(0);
    expect(await remainingSignals(machineId, otherChatroomId)).toHaveLength(1);
    expect(await remainingSignals(`other-${machineId}`, chatroomId)).toHaveLength(1);
  });

  test('caps deletions at the batch limit and reports hasMore', async () => {
    const { chatroomId, machineId } = await setup('cap');
    const keys: string[] = [];
    const total = 102;
    for (let i = 0; i < total; i++) {
      keys.push(await insertDeliverySignal(machineId, chatroomId, now + i));
    }

    const result = await t.run((ctx) =>
      ackMachineTaskDeliverySignals(ctx, {
        machineId,
        chatroomId: String(chatroomId),
        throughSignalKey: keys[keys.length - 1],
      })
    );
    expect(result.deletedCount).toBeLessThanOrEqual(100);
    expect(result.deletedCount).toBe(100);
    expect(result.hasMore).toBe(true);
    const remaining = await remainingSignals(machineId, chatroomId);
    expect(remaining).toHaveLength(total - 100);
  });
});
