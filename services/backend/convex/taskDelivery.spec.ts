/**
 * Tests for taskDelivery — daemon-owned task-delivery signal feed.
 *
 * Additive slice: the new table/endpoints must prove scope, ordering, limits,
 * auth, hydration, and cleanup without touching the legacy feed.
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { t } from '../test.setup';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';

async function createTestSession(id: string) {
  const login = await t.mutation(api.auth.loginAnon, { sessionId: id as SessionId });
  expect(login.success).toBe(true);
  return { sessionId: id as SessionId, userId: login.userId as Id<'users'> };
}

async function createChatroom(sessionId: SessionId): Promise<Id<'chatroom_rooms'>> {
  return await t.mutation(api.chatrooms.create, {
    sessionId,
    teamId: 'duo',
    teamName: 'Duo Team',
    teamRoles: ['planner', 'builder'],
    teamEntryPoint: 'planner',
  });
}

async function registerMachine(sessionId: SessionId, machineId: string): Promise<void> {
  await t.mutation(api.machines.register, {
    sessionId,
    machineId,
    hostname: 'test-host',
    os: 'linux',
    availableHarnesses: ['opencode'],
  });
}

function signalKey(updatedAt: number, taskId: string): string {
  return `${String(updatedAt).padStart(16, '0')}:${taskId}`;
}

async function seedDeliverySignal(
  machineId: string,
  chatroomId: Id<'chatroom_rooms'>,
  updatedAt: number,
  targetRole = 'builder',
  taskStatus: 'pending' | 'in_progress' | 'completed' = 'pending'
): Promise<{ taskId: Id<'chatroom_tasks'>; key: string }> {
  const taskId = await t.run(async (ctx) => {
    return await ctx.db.insert('chatroom_tasks', {
      chatroomId,
      createdBy: 'user',
      content: `delivery task ${updatedAt}`,
      status: 'pending',
      assignedTo: targetRole,
      createdAt: updatedAt,
      updatedAt,
      queuePosition: 0,
    });
  });
  const key = signalKey(updatedAt, String(taskId));
  await t.run(async (ctx) => {
    await ctx.db.insert('chatroom_machineTaskDeliverySignals', {
      machineId,
      chatroomId,
      taskId: taskId as Id<'chatroom_tasks'>,
      targetRole,
      taskStatus,
      signalKey: key,
      taskUpdatedAt: updatedAt,
    });
  });
  return { taskId: taskId as Id<'chatroom_tasks'>, key };
}

async function seedSnapshot(
  machineId: string,
  chatroomId: Id<'chatroom_rooms'>,
  taskId: Id<'chatroom_tasks'>,
  updatedAt: number,
  role = 'builder'
): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert('chatroom_machineAssignedTaskSnapshots', {
      machineId,
      taskId,
      chatroomId,
      role,
      taskStatus: 'pending',
      taskAssignedTo: role,
      taskCreatedAt: updatedAt,
      taskUpdatedAt: updatedAt,
      agentHarness: 'opencode',
      workingDir: '/tmp',
      configUpdatedAt: updatedAt,
      presenceUpdatedAt: updatedAt,
      presenceKey: `delivery-presence-${String(taskId)}`,
      revisionKey: `delivery-revision-${String(taskId)}`,
      signalUpdatedAt: updatedAt,
    });
  });
}

describe('taskDelivery.subscribeTaskDeliverySignalsSince', () => {
  test('returns signals strictly after afterKey in ascending order with exact slim shape', async () => {
    const { sessionId } = await createTestSession('delivery-sub-1');
    const chatroomId = await createChatroom(sessionId);
    const machineId = 'delivery-sub-machine-1';
    await registerMachine(sessionId, machineId);

    const now = Date.now();
    const first = await seedDeliverySignal(machineId, chatroomId, now, 'builder', 'pending');
    const second = await seedDeliverySignal(
      machineId,
      chatroomId,
      now + 1,
      'builder',
      'in_progress'
    );

    const result = await t.query(api.taskDelivery.subscribeTaskDeliverySignalsSince, {
      sessionId,
      machineId,
      chatroomId,
      afterKey: '',
    });

    expect(result).not.toBeNull();
    expect(result!.items).toHaveLength(2);
    expect(result!.items[0]).toEqual({
      chatroomId,
      taskId: first.taskId,
      targetRole: 'builder',
      taskStatus: 'pending',
      signalKey: first.key,
      taskUpdatedAt: now,
    });
    expect(result!.items[1]).toEqual({
      chatroomId,
      taskId: second.taskId,
      targetRole: 'builder',
      taskStatus: 'in_progress',
      signalKey: second.key,
      taskUpdatedAt: now + 1,
    });
    // Slim contract: no row metadata or task content.
    for (const item of result!.items) {
      expect(Object.keys(item).sort()).toEqual(
        ['chatroomId', 'signalKey', 'targetRole', 'taskId', 'taskStatus', 'taskUpdatedAt'].sort()
      );
      expect(item).not.toHaveProperty('_id');
      expect(item).not.toHaveProperty('_creationTime');
      expect(item).not.toHaveProperty('content');
    }
    expect(result!.highKey).toBe(second.key);

    // Strict-after: cursor row itself is excluded.
    const tail = await t.query(api.taskDelivery.subscribeTaskDeliverySignalsSince, {
      sessionId,
      machineId,
      chatroomId,
      afterKey: first.key,
    });
    expect(tail).not.toBeNull();
    expect(tail!.items).toHaveLength(1);
    expect(tail!.items[0].signalKey).toBe(second.key);
    expect(tail!.hasMore).toBe(false);
  });

  test('returns null when no signals after cursor', async () => {
    const { sessionId } = await createTestSession('delivery-sub-null');
    const chatroomId = await createChatroom(sessionId);
    const machineId = 'delivery-sub-machine-null';
    await registerMachine(sessionId, machineId);

    const result = await t.query(api.taskDelivery.subscribeTaskDeliverySignalsSince, {
      sessionId,
      machineId,
      chatroomId,
      afterKey: 'zzz',
    });
    expect(result).toBeNull();
  });

  test('caps at custom limit and reports hasMore', async () => {
    const { sessionId } = await createTestSession('delivery-sub-cap');
    const chatroomId = await createChatroom(sessionId);
    const machineId = 'delivery-sub-machine-cap';
    await registerMachine(sessionId, machineId);

    const now = Date.now();
    for (let i = 0; i < 5; i++) {
      await seedDeliverySignal(machineId, chatroomId, now + i);
    }

    const result = await t.query(api.taskDelivery.subscribeTaskDeliverySignalsSince, {
      sessionId,
      machineId,
      chatroomId,
      afterKey: '',
      limit: 3,
    });
    expect(result).not.toBeNull();
    expect(result!.items).toHaveLength(3);
    expect(result!.hasMore).toBe(true);
  });

  test('isolates rooms on the same machine', async () => {
    const { sessionId } = await createTestSession('delivery-sub-rooms');
    const roomA = await createChatroom(sessionId);
    const roomB = await createChatroom(sessionId);
    const machineId = 'delivery-sub-machine-rooms';
    await registerMachine(sessionId, machineId);

    const now = Date.now();
    const roomASeed = await seedDeliverySignal(machineId, roomA, now);
    await seedDeliverySignal(machineId, roomB, now);

    const resultA = await t.query(api.taskDelivery.subscribeTaskDeliverySignalsSince, {
      sessionId,
      machineId,
      chatroomId: roomA,
      afterKey: '',
    });
    expect(resultA).not.toBeNull();
    expect(resultA!.items).toHaveLength(1);
    expect(resultA!.items[0]).toMatchObject({ chatroomId: roomA, signalKey: roomASeed.key });
    expect(resultA!.highKey).toBe(roomASeed.key);
    expect(resultA!.hasMore).toBe(false);

    const resultB = await t.query(api.taskDelivery.subscribeTaskDeliverySignalsSince, {
      sessionId,
      machineId,
      chatroomId: roomB,
      afterKey: '',
    });
    expect(resultB).not.toBeNull();
    expect(resultB!.items).toHaveLength(1);
    expect(resultB!.items[0]).toMatchObject({ chatroomId: roomB });
  });

  test('returns null for an unauthorized machine', async () => {
    const { sessionId } = await createTestSession('delivery-sub-unauthorized');
    const chatroomId = await createChatroom(sessionId);

    const result = await t.query(api.taskDelivery.subscribeTaskDeliverySignalsSince, {
      sessionId,
      machineId: 'never-registered-delivery-machine',
      chatroomId,
      afterKey: '',
    });
    expect(result).toBeNull();
  });
});

describe('taskDelivery.listTasksForMachineTaskDeliverySignalRange', () => {
  test('reads the delivery table and hydrates current assigned snapshots without task content', async () => {
    const { sessionId } = await createTestSession('delivery-hydrate-1');
    const chatroomId = await createChatroom(sessionId);
    const machineId = 'delivery-hydrate-machine-1';
    await registerMachine(sessionId, machineId);

    const now = Date.now();
    const { taskId, key } = await seedDeliverySignal(machineId, chatroomId, now);
    await seedSnapshot(machineId, chatroomId, taskId, now);

    const result = await t.query(api.taskDelivery.listTasksForMachineTaskDeliverySignalRange, {
      sessionId,
      machineId,
      chatroomId,
      afterSignalKey: '',
      throughSignalKey: key,
    });

    expect(result.snapshots).toHaveLength(1);
    expect(String(result.snapshots[0].taskId)).toBe(String(taskId));
    expect(String(result.snapshots[0].chatroomId)).toBe(String(chatroomId));
    expect(result.nextSignalKey).toBe(key);
    expect(result.hasMore).toBe(false);
    // Assigned snapshot views never expose task content.
    expect(result.snapshots[0]).not.toHaveProperty('content');
  });

  test('returns empty page for an unauthorized machine', async () => {
    const { sessionId } = await createTestSession('delivery-hydrate-unauthorized');
    const chatroomId = await createChatroom(sessionId);

    const result = await t.query(api.taskDelivery.listTasksForMachineTaskDeliverySignalRange, {
      sessionId,
      machineId: 'never-registered-delivery-hydrate-machine',
      chatroomId,
      afterSignalKey: '',
      throughSignalKey: 'zzz',
    });
    expect(result).toEqual({ snapshots: [], nextSignalKey: null, hasMore: false });
  });
});

describe('taskDelivery.ackTaskDeliverySignals', () => {
  test('deletes only target machine/chatroom rows through the key and reports bounded hasMore', async () => {
    const { sessionId } = await createTestSession('delivery-ack-1');
    const chatroomId = await createChatroom(sessionId);
    const otherChatroomId = await createChatroom(sessionId);
    const machineId = 'delivery-ack-machine-1';
    await registerMachine(sessionId, machineId);

    const now = Date.now();
    const first = await seedDeliverySignal(machineId, chatroomId, now);
    const second = await seedDeliverySignal(machineId, chatroomId, now + 1);
    await seedDeliverySignal(machineId, otherChatroomId, now);

    const result = await t.mutation(api.taskDelivery.ackTaskDeliverySignals, {
      sessionId,
      machineId,
      chatroomId,
      throughSignalKey: first.key,
    });
    expect(result.deletedCount).toBe(1);
    expect(result.hasMore).toBe(false);

    // Later signal in the same room survives; the other room is untouched.
    const remaining = await t.query(api.taskDelivery.subscribeTaskDeliverySignalsSince, {
      sessionId,
      machineId,
      chatroomId,
      afterKey: '',
    });
    expect(remaining).not.toBeNull();
    expect(remaining!.items.map((item) => item.signalKey)).toEqual([second.key]);

    const otherRoom = await t.query(api.taskDelivery.subscribeTaskDeliverySignalsSince, {
      sessionId,
      machineId,
      chatroomId: otherChatroomId,
      afterKey: '',
    });
    expect(otherRoom).not.toBeNull();
    expect(otherRoom!.items).toHaveLength(1);
  });
});
