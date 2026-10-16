/**
 * notify-user — Integration Tests
 *
 * Verifies `api.messages.notifyUser` stores an agent → user interim notice with
 * no task transition: the schema union widens, the row is task-free, the read
 * model marks it as timeline, and the active-task gate blocks senders with no
 * work in flight.
 */

import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { t } from '../../test.setup';
import {
  createPlannerBuilderDuoChatroom,
  createTestSession,
  joinParticipant,
} from '../helpers/integration';

/** Seed a user-origin message plus its task, and return both IDs. */
async function seedUserOriginTask(
  chatroomId: Id<'chatroom_rooms'>,
  content: string,
  assignedTo: string,
  status: 'pending' | 'acknowledged' | 'in_progress'
): Promise<{ userMessageId: Id<'chatroom_messages'>; taskId: Id<'chatroom_tasks'> }> {
  return await t.run(async (ctx) => {
    const userMessageId = await ctx.db.insert('chatroom_messages', {
      chatroomId,
      senderRole: 'user',
      content,
      targetRole: assignedTo,
      type: 'message',
      acknowledgedAt: Date.now(),
    });
    const now = Date.now();
    const taskId = await ctx.db.insert('chatroom_tasks', {
      chatroomId,
      createdBy: 'user',
      content,
      status,
      assignedTo,
      sourceMessageId: userMessageId,
      createdAt: now,
      updatedAt: now,
      queuePosition: 1,
    });
    return { userMessageId, taskId };
  });
}

async function readUnreadStatus(chatroomId: Id<'chatroom_rooms'>) {
  return await t.run(async (ctx) => {
    const chatroom = await ctx.db.get('chatroom_rooms', chatroomId);
    return await ctx.db
      .query('chatroom_unreadStatus')
      .withIndex('by_userId_chatroomId', (q) =>
        q.eq('userId', chatroom!.ownerId!).eq('chatroomId', chatroomId)
      )
      .first();
  });
}

describe('messages.notifyUser', () => {
  test('stores a task-free notice and marks the chatroom unread without a handoff flag', async () => {
    const { sessionId } = await createTestSession('notify-user-basic');
    const chatroomId = await createPlannerBuilderDuoChatroom(sessionId);
    await joinParticipant(sessionId, chatroomId, 'planner');
    await joinParticipant(sessionId, chatroomId, 'builder');

    const { taskId } = await seedUserOriginTask(
      chatroomId,
      'Build feature X',
      'builder',
      'in_progress'
    );

    const before = await t.run(async (ctx) => {
      const task = await ctx.db.get('chatroom_tasks', taskId);
      const chatroom = await ctx.db.get('chatroom_rooms', chatroomId);
      const tasks = await ctx.db
        .query('chatroom_tasks')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .collect();
      return { task, lastActivityAt: chatroom!.lastActivityAt, taskCount: tasks.length };
    });

    const { messageId } = await t.mutation(api.messages.notifyUser, {
      sessionId,
      chatroomId,
      senderRole: 'builder',
      content: 'Heads up — still working on this.',
    });
    expect(messageId).toBeTruthy();

    const message = await t.run((ctx) => ctx.db.get('chatroom_messages', messageId));
    expect(message).not.toBeNull();
    expect(message!.type).toBe('notice');
    expect(message!.senderRole).toBe('builder');
    expect(message!.targetRole).toBe('user');
    expect(message!.content).toBe('Heads up — still working on this.');
    expect(message!.taskId).toBeUndefined();
    expect(message!.taskOriginMessageId).toBeUndefined();

    const readModel = await t.run((ctx) =>
      ctx.db
        .query('chatroom_messageReadModels')
        .withIndex('by_messageId', (q) => q.eq('messageId', messageId))
        .first()
    );
    expect(readModel).not.toBeNull();
    expect(readModel!.type).toBe('notice');
    expect(readModel!.isTimeline).toBe(true);

    const after = await t.run(async (ctx) => {
      const task = await ctx.db.get('chatroom_tasks', taskId);
      const chatroom = await ctx.db.get('chatroom_rooms', chatroomId);
      const tasks = await ctx.db
        .query('chatroom_tasks')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .collect();
      return { task, lastActivityAt: chatroom!.lastActivityAt, taskCount: tasks.length };
    });

    expect(after.task!.status).toBe(before.task!.status);
    expect(after.task!.assignedTo).toBe(before.task!.assignedTo);
    expect(after.task!.queuePosition).toBe(before.task!.queuePosition);
    expect(after.taskCount).toBe(before.taskCount);
    expect(after.lastActivityAt).toBe(before.lastActivityAt);

    const unread = await readUnreadStatus(chatroomId);
    expect(unread).not.toBeNull();
    expect(unread!.hasUnread).toBe(true);
    expect(unread!.hasUnreadHandoff).toBe(false);
  });

  test('a sender with only a pending task can notify', async () => {
    const { sessionId } = await createTestSession('notify-user-pending');
    const chatroomId = await createPlannerBuilderDuoChatroom(sessionId);
    await joinParticipant(sessionId, chatroomId, 'planner');
    await joinParticipant(sessionId, chatroomId, 'builder');

    await seedUserOriginTask(chatroomId, 'Pending work', 'builder', 'pending');

    const { messageId } = await t.mutation(api.messages.notifyUser, {
      sessionId,
      chatroomId,
      senderRole: 'builder',
      content: 'Picking this up now.',
    });
    expect(messageId).toBeTruthy();
  });

  test('after handing off to planner the builder has no active task', async () => {
    const { sessionId } = await createTestSession('notify-user-after-handoff');
    const chatroomId = await createPlannerBuilderDuoChatroom(sessionId);
    await joinParticipant(sessionId, chatroomId, 'planner');
    await joinParticipant(sessionId, chatroomId, 'builder');

    await seedUserOriginTask(chatroomId, 'Builder work', 'builder', 'in_progress');

    const handoff = await t.mutation(api.messages.handoff, {
      sessionId,
      chatroomId,
      senderRole: 'builder',
      targetRole: 'planner',
      content: 'Ready for review.',
    });
    expect(handoff.success).toBe(true);

    await expect(
      t.mutation(api.messages.notifyUser, {
        sessionId,
        chatroomId,
        senderRole: 'builder',
        content: 'One more thing…',
      })
    ).rejects.toMatchObject({ data: { code: 'NO_ACTIVE_TASK' } });
  });

  test('rejects the user role and unknown roles', async () => {
    const { sessionId } = await createTestSession('notify-user-invalid-role');
    const chatroomId = await createPlannerBuilderDuoChatroom(sessionId);
    await joinParticipant(sessionId, chatroomId, 'builder');

    await expect(
      t.mutation(api.messages.notifyUser, {
        sessionId,
        chatroomId,
        senderRole: 'user',
        content: 'Should not be allowed',
      })
    ).rejects.toMatchObject({ data: { code: 'INVALID_ROLE' } });

    await expect(
      t.mutation(api.messages.notifyUser, {
        sessionId,
        chatroomId,
        senderRole: 'ghost',
        content: 'Should not be allowed',
      })
    ).rejects.toMatchObject({ data: { code: 'INVALID_ROLE' } });
  });

  test('validates content emptiness and length', async () => {
    const { sessionId } = await createTestSession('notify-user-content');
    const chatroomId = await createPlannerBuilderDuoChatroom(sessionId);
    await joinParticipant(sessionId, chatroomId, 'planner');
    await joinParticipant(sessionId, chatroomId, 'builder');

    await seedUserOriginTask(chatroomId, 'Content bounds work', 'builder', 'in_progress');

    await expect(
      t.mutation(api.messages.notifyUser, {
        sessionId,
        chatroomId,
        senderRole: 'builder',
        content: '   ',
      })
    ).rejects.toMatchObject({ data: { code: 'EMPTY_CONTENT' } });

    await expect(
      t.mutation(api.messages.notifyUser, {
        sessionId,
        chatroomId,
        senderRole: 'builder',
        content: 'x'.repeat(10_001),
      })
    ).rejects.toMatchObject({ data: { code: 'CONTENT_TOO_LONG' } });

    const { messageId } = await t.mutation(api.messages.notifyUser, {
      sessionId,
      chatroomId,
      senderRole: 'builder',
      content: 'x'.repeat(10_000),
    });
    expect(messageId).toBeTruthy();
  });

  test('a session from another user cannot notify', async () => {
    const { sessionId: ownerSession } = await createTestSession('notify-user-owner');
    const { sessionId: attackerSession } = await createTestSession('notify-user-attacker');
    const chatroomId = await createPlannerBuilderDuoChatroom(ownerSession);
    await joinParticipant(ownerSession, chatroomId, 'builder');
    await seedUserOriginTask(chatroomId, 'Owner work', 'builder', 'in_progress');

    await expect(
      t.mutation(api.messages.notifyUser, {
        sessionId: attackerSession,
        chatroomId,
        senderRole: 'builder',
        content: 'Should be denied',
      })
    ).rejects.toMatchObject({ data: { code: 'ACCESS_DENIED' } });
  });

  test('notice precedes a handoff-to-user and does not disturb task origin resolution', async () => {
    const { sessionId } = await createTestSession('notify-user-before-handoff');
    const chatroomId = await createPlannerBuilderDuoChatroom(sessionId);
    await joinParticipant(sessionId, chatroomId, 'planner');
    await joinParticipant(sessionId, chatroomId, 'builder');

    const { userMessageId, taskId } = await seedUserOriginTask(
      chatroomId,
      'Please build X',
      'builder',
      'in_progress'
    );

    const { messageId: noticeId } = await t.mutation(api.messages.notifyUser, {
      sessionId,
      chatroomId,
      senderRole: 'builder',
      content: 'Interim notice.',
    });
    expect(noticeId).toBeTruthy();

    const handoff = await t.mutation(api.messages.handoff, {
      sessionId,
      chatroomId,
      senderRole: 'builder',
      targetRole: 'user',
      content: 'All done.',
    });
    expect(handoff.success).toBe(true);
    expect(handoff.completedTaskIds).toEqual([taskId]);

    const handoffMessage = await t.run((ctx) =>
      ctx.db.get('chatroom_messages', handoff.messageId!)
    );
    expect(handoffMessage!.taskOriginMessageId).toBe(userMessageId);

    const latest = await t.query(api.messageList.getLatestMessages, {
      sessionId,
      chatroomId,
      limit: 20,
    });
    const contents = latest.messages.map((m) => m.content);
    const userIndex = contents.indexOf('Please build X');
    const noticeIndex = contents.indexOf('Interim notice.');
    const handoffIndex = contents.indexOf('All done.');
    expect(userIndex).toBeGreaterThanOrEqual(0);
    expect(noticeIndex).toBeGreaterThanOrEqual(0);
    expect(handoffIndex).toBeGreaterThanOrEqual(0);
    expect(userIndex).toBeLessThan(noticeIndex);
    expect(noticeIndex).toBeLessThan(handoffIndex);

    const tasksWithStatus = await t.run(async (ctx) =>
      ctx.db
        .query('chatroom_tasks')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .collect()
    );
    // The builder task completed exactly once; no duplicate from the notice.
    expect(
      tasksWithStatus.filter((task) => task._id === taskId && task.status === 'completed')
    ).toHaveLength(1);
  });
});
