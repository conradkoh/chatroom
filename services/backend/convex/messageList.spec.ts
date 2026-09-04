/**
 * Tests for messageList — bounded fetch queries.
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { t } from '../test.setup';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

async function seedMessages(
  chatroomId: Id<'chatroom_rooms'>,
  count: number
): Promise<Id<'chatroom_messages'>[]> {
  return await t.run(async (ctx) => {
    const ids: Id<'chatroom_messages'>[] = [];
    for (let i = 0; i < count; i++) {
      const id = await ctx.db.insert('chatroom_messages', {
        chatroomId,
        senderRole: 'user',
        targetRole: 'builder',
        content: `message ${i}`,
        type: 'message',
      });
      ids.push(id as Id<'chatroom_messages'>);
    }
    return ids;
  });
}

async function seedQueuedMessages(
  chatroomId: Id<'chatroom_rooms'>,
  count: number
): Promise<Id<'chatroom_messageQueue'>[]> {
  return await t.run(async (ctx) => {
    const ids: Id<'chatroom_messageQueue'>[] = [];
    for (let i = 0; i < count; i++) {
      const id = await ctx.db.insert('chatroom_messageQueue', {
        chatroomId,
        senderRole: 'user',
        targetRole: 'builder',
        content: `queued ${i}`,
        type: 'message',
        queuePosition: i,
      });
      ids.push(id as Id<'chatroom_messageQueue'>);
    }
    return ids;
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('listQueued — bounded fetch', () => {
  test('respects limit cap when using .take()', async () => {
    const { sessionId } = await createTestSession('bounded-queued-1');
    const chatroomId = await createChatroom(sessionId);

    // Seed 1500 queued messages — more than the 1000 limit
    await seedQueuedMessages(chatroomId, 1500);

    const result = await t.query(api.messages.listQueued, {
      sessionId,
      chatroomId,
    });

    // Should be capped at 1000
    expect(result.length).toBeLessThanOrEqual(1000);
  });

  test('respects custom limit when provided', async () => {
    const { sessionId } = await createTestSession('bounded-queued-2');
    const chatroomId = await createChatroom(sessionId);

    // Seed 50 queued messages
    await seedQueuedMessages(chatroomId, 50);

    const result = await t.query(api.messages.listQueued, {
      sessionId,
      chatroomId,
      limit: 20,
    });

    // Should respect the custom limit of 20
    expect(result.length).toBe(20);
  });

  test('returns all queued messages when count is below limit', async () => {
    const { sessionId } = await createTestSession('bounded-queued-3');
    const chatroomId = await createChatroom(sessionId);

    // Seed 50 queued messages — well below the 1000 limit
    await seedQueuedMessages(chatroomId, 50);

    const result = await t.query(api.messages.listQueued, {
      sessionId,
      chatroomId,
    });

    // Should return all 50 messages
    expect(result.length).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// subscribeNewMessages — strict-after cursor
// ---------------------------------------------------------------------------

describe('subscribeNewMessages — strict-after cursor', () => {
  test('returns only messages strictly after the cursor (excludes the cursor row)', async () => {
    const { sessionId } = await createTestSession('new-msgs-1');
    const chatroomId = await createChatroom(sessionId);

    const ids = await seedMessages(chatroomId, 5);

    // Get the _creationTime of the 3rd message (index 2) as cursor
    const cursor = await t.run(async (ctx) => {
      const msg = await ctx.db.get('chatroom_messages', ids[2]);
      if (!msg) throw new Error('seeded message not found');
      return msg._creationTime;
    });

    const result = await t.query(api.messageList.subscribeNewMessages, {
      sessionId,
      chatroomId,
      afterCreationTime: cursor,
    });

    // Should exclude the cursor row (index 2) and include only strictly after (indices 3, 4)
    expect(result.length).toBe(2);
    expect(result[0]._id).toBe(ids[3]);
    expect(result[1]._id).toBe(ids[4]);
  });

  test('returns empty when cursor is at/after the newest message', async () => {
    const { sessionId } = await createTestSession('new-msgs-2');
    const chatroomId = await createChatroom(sessionId);

    const ids = await seedMessages(chatroomId, 3);

    // Use _creationTime of the newest (last) message as cursor
    const cursor = await t.run(async (ctx) => {
      const msg = await ctx.db.get('chatroom_messages', ids[2]);
      if (!msg) throw new Error('seeded message not found');
      return msg._creationTime;
    });

    const result = await t.query(api.messageList.subscribeNewMessages, {
      sessionId,
      chatroomId,
      afterCreationTime: cursor,
    });

    expect(result.length).toBe(0);
  });

  test('caps at MAX_NEW_MESSAGES_LIMIT (500)', async () => {
    const { sessionId } = await createTestSession('new-msgs-3');
    const chatroomId = await createChatroom(sessionId);

    // Seed 600 messages — more than the 500 limit
    await seedMessages(chatroomId, 600);

    const result = await t.query(api.messageList.subscribeNewMessages, {
      sessionId,
      chatroomId,
      afterCreationTime: 0,
    });

    expect(result.length).toBeLessThanOrEqual(500);
  });
});

// ---------------------------------------------------------------------------
// subscribeTaskStatusSignalsSince — cursor-based task status signals
// ---------------------------------------------------------------------------

describe('subscribeTaskStatusSignalsSince — cursor-based task status signals', () => {
  test('returns signals strictly after afterKey in ascending order', async () => {
    const { sessionId } = await createTestSession('task-signals-1');
    const chatroomId = await createChatroom(sessionId);
    const machineId = 'task-signals-machine-1';
    await registerMachine(sessionId, machineId);

    const now = Date.now();
    const taskId = await t.run(async (ctx) => {
      return await ctx.db.insert('chatroom_tasks', {
        chatroomId,
        createdBy: 'user',
        content: 'test task',
        status: 'in_progress',
        createdAt: now,
        updatedAt: now,
        queuePosition: 0,
      });
    });

    // Insert signal rows directly
    const key1 = `${String(now).padStart(16, '0')}:${taskId}`;
    const key2 = `${String(now + 1).padStart(16, '0')}:${taskId}`;
    await t.run(async (ctx) => {
      await ctx.db.insert('chatroom_machineTaskStatusSignals', {
        chatroomId,
        taskId: taskId as Id<'chatroom_tasks'>,
        machineId: machineId,
        targetRole: 'planner',
        taskStatus: 'in_progress',
        signalKey: key1,
        taskUpdatedAt: now,
      });
      await ctx.db.insert('chatroom_machineTaskStatusSignals', {
        chatroomId,
        taskId: taskId as Id<'chatroom_tasks'>,
        machineId: machineId,
        targetRole: 'planner',
        taskStatus: 'completed',
        signalKey: key2,
        taskUpdatedAt: now + 1,
      });
    });

    // Query with afterKey before first signal
    const result = await t.query(api.messageList.subscribeTaskStatusSignalsSince, {
      sessionId,
      machineId,
      chatroomId,
      afterKey: '',
    });

    expect(result).not.toBeNull();
    expect(result!.items).toHaveLength(2);
    expect(result!.items[0]).toEqual({
      chatroomId,
      taskId,
      targetRole: 'planner',
      taskStatus: 'in_progress',
      signalKey: key1,
      taskUpdatedAt: now,
    });
    expect(result!.items[1]).toEqual({
      chatroomId,
      taskId,
      targetRole: 'planner',
      taskStatus: 'completed',
      signalKey: key2,
      taskUpdatedAt: now + 1,
    });
    expect(result!.highKey).toBe(key2);
    expect(result!.hasMore).toBe(false);
  });

  test('returns null when no signals after cursor', async () => {
    const { sessionId } = await createTestSession('task-signals-null');
    const chatroomId = await createChatroom(sessionId);
    const machineId = 'task-signals-machine-null';
    await registerMachine(sessionId, machineId);

    const result = await t.query(api.messageList.subscribeTaskStatusSignalsSince, {
      sessionId,
      machineId,
      chatroomId,
      afterKey: 'zzz',
    });

    expect(result).toBeNull();
  });

  test('caps at limit', async () => {
    const { sessionId } = await createTestSession('task-signals-cap');
    const chatroomId = await createChatroom(sessionId);
    const machineId = 'task-signals-machine-cap';
    await registerMachine(sessionId, machineId);

    const now = Date.now();
    for (let i = 0; i < 5; i++) {
      const taskId = await t.run(async (ctx) => {
        return await ctx.db.insert('chatroom_tasks', {
          chatroomId,
          createdBy: 'user',
          content: `task ${i}`,
          status: 'pending',
          createdAt: now + i,
          updatedAt: now + i,
          queuePosition: i,
        });
      });
      const key = `${String(now + i).padStart(16, '0')}:${taskId}`;
      await t.run(async (ctx) => {
        await ctx.db.insert('chatroom_machineTaskStatusSignals', {
          chatroomId,
          taskId,
          machineId: machineId,
          targetRole: 'planner',
          taskStatus: 'pending',
          signalKey: key,
          taskUpdatedAt: now + i,
        });
      });
    }

    const result = await t.query(api.messageList.subscribeTaskStatusSignalsSince, {
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

  test('excludes signals from another room on the same machine', async () => {
    const { sessionId } = await createTestSession('task-signals-rooms');
    const roomA = await createChatroom(sessionId);
    const roomB = await createChatroom(sessionId);
    const machineId = 'task-signals-machine-rooms';
    await registerMachine(sessionId, machineId);

    const now = Date.now();
    const insertSignal = async (chatroomId: Id<'chatroom_rooms'>, marker: string) => {
      const taskId = await t.run(async (ctx) => {
        return await ctx.db.insert('chatroom_tasks', {
          chatroomId,
          createdBy: 'user',
          content: `task ${marker}`,
          status: 'pending',
          createdAt: now,
          updatedAt: now,
          queuePosition: 0,
        });
      });
      const key = `${String(now).padStart(16, '0')}:${taskId}`;
      await t.run(async (ctx) => {
        await ctx.db.insert('chatroom_machineTaskStatusSignals', {
          chatroomId,
          taskId: taskId as Id<'chatroom_tasks'>,
          machineId,
          targetRole: 'planner',
          taskStatus: 'pending',
          signalKey: key,
          taskUpdatedAt: now,
        });
      });
      return key;
    };
    const roomAKey = await insertSignal(roomA, 'A');
    await insertSignal(roomB, 'B');

    const resultA = await t.query(api.messageList.subscribeTaskStatusSignalsSince, {
      sessionId,
      machineId,
      chatroomId: roomA,
      afterKey: '',
    });

    expect(resultA).not.toBeNull();
    expect(resultA!.items).toHaveLength(1);
    expect(resultA!.items[0]).toMatchObject({ chatroomId: roomA, signalKey: roomAKey });
    expect(resultA!.highKey).toBe(roomAKey);
    expect(resultA!.hasMore).toBe(false);

    const resultB = await t.query(api.messageList.subscribeTaskStatusSignalsSince, {
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
    const { sessionId } = await createTestSession('task-signals-unauthorized');
    const chatroomId = await createChatroom(sessionId);

    const result = await t.query(api.messageList.subscribeTaskStatusSignalsSince, {
      sessionId,
      machineId: 'never-registered-task-signals-machine',
      chatroomId,
      afterKey: '',
    });

    expect(result).toBeNull();
  });
});
