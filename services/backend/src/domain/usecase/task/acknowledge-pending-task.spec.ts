/**
 * Unit tests for acknowledgePendingTask
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { acknowledgePendingTask } from './acknowledge-pending-task';
import { api } from '../../../../convex/_generated/api';
import type { Doc, Id } from '../../../../convex/_generated/dataModel';
import { t } from '../../../../test.setup';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createTestSession(id: string) {
  const login = await t.mutation(api.auth.loginAnon, { sessionId: id as SessionId });
  expect(login.success).toBe(true);
  return { sessionId: id as SessionId };
}

async function createChatroom(sessionId: SessionId): Promise<Id<'chatroom_rooms'>> {
  return await t.mutation(api.chatrooms.create, {
    sessionId,
    teamId: 'duo',
    teamName: 'Duo Team',
    teamRoles: ['planner', 'builder'],
    teamEntryPoint: 'builder',
  });
}

async function seedPendingTask(
  chatroomId: Id<'chatroom_rooms'>,
  opts?: { sourceMessageId?: Id<'chatroom_messages'> }
): Promise<Doc<'chatroom_tasks'>> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const taskId = await ctx.db.insert('chatroom_tasks', {
      chatroomId,
      createdBy: 'user',
      content: 'test task',
      status: 'pending',
      sourceMessageId: opts?.sourceMessageId,
      createdAt: now,
      updatedAt: now,
      queuePosition: 0,
    });
    return (await ctx.db.get('chatroom_tasks', taskId))!;
  });
}

async function seedMessage(
  chatroomId: Id<'chatroom_rooms'>,
  opts?: { acknowledgedAt?: number }
): Promise<Id<'chatroom_messages'>> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert('chatroom_messages', {
      chatroomId,
      senderRole: 'user',
      content: 'source message',
      type: 'message',
      ...(opts?.acknowledgedAt !== undefined ? { acknowledgedAt: opts.acknowledgedAt } : {}),
    });
  });
}

async function getParticipantStatus(chatroomId: Id<'chatroom_rooms'>, role: string) {
  return t.run(async (ctx) => {
    const p = await ctx.db
      .query('chatroom_participants')
      .withIndex('by_chatroom_and_role', (q) => q.eq('chatroomId', chatroomId).eq('role', role))
      .unique();
    return p?.lastStatus ?? null;
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('acknowledgePendingTask', () => {
  test('transitions pending task to acknowledged and assigns role', async () => {
    const { sessionId } = await createTestSession('apt-transition');
    const chatroomId = await createChatroom(sessionId);
    const pendingTask = await seedPendingTask(chatroomId);

    await t.run(async (ctx) => {
      await acknowledgePendingTask(ctx, {
        chatroomId,
        role: 'builder',
        pendingTask,
      });
    });

    const task = await t.run(async (ctx) => ctx.db.get('chatroom_tasks', pendingTask._id));
    expect(task?.status).toBe('acknowledged');
    expect(task?.assignedTo).toBe('builder');
  });

  test('emits task.acknowledged event on chatroom_eventStream', async () => {
    const { sessionId } = await createTestSession('apt-event');
    const chatroomId = await createChatroom(sessionId);
    const pendingTask = await seedPendingTask(chatroomId);

    await t.run(async (ctx) => {
      await acknowledgePendingTask(ctx, {
        chatroomId,
        role: 'builder',
        pendingTask,
      });
    });

    const events = await t.run(async (ctx) => {
      return await ctx.db
        .query('chatroom_eventStream')
        .withIndex('by_chatroom_type', (q) =>
          q.eq('chatroomId', chatroomId).eq('type', 'task.acknowledged')
        )
        .collect();
    });

    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('task.acknowledged');
    if (events[0]?.type === 'task.acknowledged') {
      expect(events[0].role).toBe('builder');
      expect(events[0].taskId).toBe(pendingTask._id);
    }
  });

  test('sets participant lastStatus to task.acknowledged via transitionAgentStatus', async () => {
    const { sessionId } = await createTestSession('apt-participant');
    const chatroomId = await createChatroom(sessionId);
    const pendingTask = await seedPendingTask(chatroomId);

    await t.mutation(api.participants.join, {
      sessionId,
      chatroomId,
      role: 'builder',
      action: 'get-next-task:started',
    });

    await t.run(async (ctx) => {
      await acknowledgePendingTask(ctx, {
        chatroomId,
        role: 'builder',
        pendingTask,
      });
    });

    const lastStatus = await getParticipantStatus(chatroomId, 'builder');
    expect(lastStatus).toBe('task.acknowledged');
  });

  test('patches source message acknowledgedAt when sourceMessageId set and message unacknowledged', async () => {
    const { sessionId } = await createTestSession('apt-msg-patch');
    const chatroomId = await createChatroom(sessionId);
    const messageId = await seedMessage(chatroomId);
    const pendingTask = await seedPendingTask(chatroomId, { sourceMessageId: messageId });

    await t.run(async (ctx) => {
      await acknowledgePendingTask(ctx, {
        chatroomId,
        role: 'builder',
        pendingTask,
      });
    });

    const message = await t.run(async (ctx) => ctx.db.get('chatroom_messages', messageId));
    expect(message?.acknowledgedAt).toBeDefined();
  });

  test('skips source message patch when acknowledgedAt already set', async () => {
    const { sessionId } = await createTestSession('apt-msg-skip');
    const chatroomId = await createChatroom(sessionId);
    const existingAckAt = 1_700_000_000_000;
    const messageId = await seedMessage(chatroomId, { acknowledgedAt: existingAckAt });
    const pendingTask = await seedPendingTask(chatroomId, { sourceMessageId: messageId });

    await t.run(async (ctx) => {
      await acknowledgePendingTask(ctx, {
        chatroomId,
        role: 'builder',
        pendingTask,
      });
    });

    const message = await t.run(async (ctx) => ctx.db.get('chatroom_messages', messageId));
    expect(message?.acknowledgedAt).toBe(existingAckAt);
  });

  test('works when pending task has no sourceMessageId', async () => {
    const { sessionId } = await createTestSession('apt-no-source');
    const chatroomId = await createChatroom(sessionId);
    const pendingTask = await seedPendingTask(chatroomId);

    await t.run(async (ctx) => {
      await acknowledgePendingTask(ctx, {
        chatroomId,
        role: 'builder',
        pendingTask,
      });
    });

    const task = await t.run(async (ctx) => ctx.db.get('chatroom_tasks', pendingTask._id));
    expect(task?.status).toBe('acknowledged');
  });
});
