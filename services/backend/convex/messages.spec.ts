/**
 * Tests for _sendMessageHandler — verifies queued user message routing.
 */

import {
  withTaskEnvelopeConversationMode,
  withTaskEnvelopeSessionPolicy,
  type TaskEnvelopeV1,
} from '@workspace/shared/domain/task-envelope';
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

async function joinParticipants(
  sessionId: SessionId,
  chatroomId: Id<'chatroom_rooms'>,
  roles: string[]
): Promise<void> {
  for (const role of roles) {
    await t.mutation(api.participants.join, {
      sessionId,
      chatroomId,
      role,
      action: 'get-next-task:started',
    });
  }
}

async function seedActiveTask(chatroomId: Id<'chatroom_rooms'>) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const taskId = await ctx.db.insert('chatroom_tasks', {
      chatroomId,
      createdBy: 'user',
      content: 'active task',
      status: 'in_progress',
      createdAt: now,
      updatedAt: now,
      queuePosition: 0,
    });
    await ctx.db.insert('chatroom_taskCounts', {
      chatroomId,
      pending: 0,
      acknowledged: 0,
      inProgress: 1,
      completed: 0,
      queueSize: 0,
      backlogCount: 0,
      pendingReviewCount: 0,
    });
    return taskId;
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('_sendMessageHandler — queued user message routing', () => {
  test('first user message (no active tasks) → stored in chatroom_messages, task.sourceMessageId set', async () => {
    const { sessionId } = await createTestSession('msg-route-1');
    const chatroomId = await createChatroom(sessionId);

    // Send first user message (no active tasks)
    const messageId = await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      senderRole: 'user',
      content: 'first message',
      type: 'message',
    });

    // Verify message is in chatroom_messages
    const message = await t.run(async (ctx) => {
      return await ctx.db.get('chatroom_messages', messageId as Id<'chatroom_messages'>);
    });
    expect(message).toBeDefined();
    expect(message?.content).toBe('first message');

    // Verify task was created with sourceMessageId
    const task = await t.run(async (ctx) => {
      return await ctx.db
        .query('chatroom_tasks')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .first();
    });
    expect(task).toBeDefined();
    expect(task?.status).toBe('pending');
    expect(task?.sourceMessageId).toBe(messageId);
  });

  test('second user message (active task exists) → stored in chatroom_messageQueue, no task created yet', async () => {
    const { sessionId } = await createTestSession('msg-route-2');
    const chatroomId = await createChatroom(sessionId);

    // Seed an active task
    await seedActiveTask(chatroomId);

    // Send second user message
    const returnedId = await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      senderRole: 'user',
      content: 'second message',
      type: 'message',
    });

    // Verify message IS in chatroom_messageQueue
    const queuedMessage = await t.run(async (ctx) => {
      return await ctx.db.get('chatroom_messageQueue', returnedId as Id<'chatroom_messageQueue'>);
    });
    expect(queuedMessage).toBeDefined();
    expect(queuedMessage?.content).toBe('second message');

    // Verify message is NOT in chatroom_messages (should be queued)
    const messagesInRegularTable = await t.run(async (ctx) => {
      return await ctx.db
        .query('chatroom_messages')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .collect();
    });
    const regularMessage = messagesInRegularTable.find((m) => m.content === 'second message');
    expect(regularMessage).toBeUndefined();

    // Verify NO task was created (tasks are created at promotion time now)
    const tasks = await t.run(async (ctx) => {
      return await ctx.db
        .query('chatroom_tasks')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .collect();
    });
    // Only the seeded in_progress task should exist — no new task (tasks created at promotion time)
    expect(tasks.length).toBe(1); // Just the seeded one
    expect(tasks[0]?.status).toBe('in_progress');
  });

  test('second user message → chatroom_messages does NOT contain the queued message', async () => {
    const { sessionId } = await createTestSession('msg-route-3');
    const chatroomId = await createChatroom(sessionId);

    // Seed an active task
    await seedActiveTask(chatroomId);

    // Send second user message
    await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      senderRole: 'user',
      content: 'queued message',
      type: 'message',
    });

    // Verify chatroom_messages only contains the initial task message (if any)
    // and NOT the queued message
    const messagesInRegularTable = await t.run(async (ctx) => {
      return await ctx.db
        .query('chatroom_messages')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .collect();
    });

    // Should not contain our queued message
    const queuedMessageInRegular = messagesInRegularTable.find(
      (m) => m.content === 'queued message'
    );
    expect(queuedMessageInRegular).toBeUndefined();
  });

  test('handoff message → always stored in chatroom_messages regardless of active tasks', async () => {
    const { sessionId } = await createTestSession('msg-route-4');
    const chatroomId = await createChatroom(sessionId);

    // Seed an active task
    await seedActiveTask(chatroomId);

    // Send handoff message (even with active task, should go to chatroom_messages)
    const messageId = await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      senderRole: 'builder',
      targetRole: 'planner',
      content: 'handoff message',
      type: 'handoff',
    });

    // Verify message is in chatroom_messages
    const message = await t.run(async (ctx) => {
      return await ctx.db.get('chatroom_messages', messageId as Id<'chatroom_messages'>);
    });
    expect(message).toBeDefined();
    expect(message?.content).toBe('handoff message');

    // Verify it's NOT in the queue (check by querying the table)
    const queuedMessages = await t.run(async (ctx) => {
      return await ctx.db
        .query('chatroom_messageQueue')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .collect();
    });
    const foundInQueue = queuedMessages.find((m) => m.content === 'handoff message');
    expect(foundInQueue).toBeUndefined();
  });

  test('queued user message → only queue record created, no task yet', async () => {
    const { sessionId } = await createTestSession('msg-route-5');
    const chatroomId = await createChatroom(sessionId);

    // Seed an active task
    await seedActiveTask(chatroomId);

    // Send queued user message
    const returnedId = await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      senderRole: 'user',
      content: 'queued message',
      type: 'message',
    });

    // Verify queue record was created
    const queueRecord = await t.run(async (ctx) => {
      return await ctx.db.get('chatroom_messageQueue', returnedId as Id<'chatroom_messageQueue'>);
    });
    expect(queueRecord).toBeDefined();
    expect(queueRecord?.content).toBe('queued message');

    // Verify NO new task was created (only the seeded one should exist)
    const tasks = await t.run(async (ctx) => {
      return await ctx.db
        .query('chatroom_tasks')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .collect();
    });
    // Should only have the seeded in_progress task
    expect(tasks.length).toBe(1);
    expect(tasks[0]?.status).toBe('in_progress');
  });
});

describe('enqueueMessageAtFront', () => {
  test('puts new message before existing queued messages when active task exists', async () => {
    const { sessionId } = await createTestSession('enqueue-front-order');
    const chatroomId = await createChatroom(sessionId);
    await seedActiveTask(chatroomId);
    await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      senderRole: 'user',
      content: 'existing',
      type: 'message',
    });
    await t.mutation(api.messages.enqueueMessageAtFront, {
      sessionId,
      chatroomId,
      content: 'front',
    });
    const queued = await t.query(api.messages.listQueued, { sessionId, chatroomId });
    expect(queued.map((m) => m.content)).toEqual(['front', 'existing']);
    expect(queued[0]!.queuePosition).toBeLessThan(queued[1]!.queuePosition);
  });

  test('reindexes when front queue item is at position 0', async () => {
    const { sessionId } = await createTestSession('enqueue-front-reindex');
    const chatroomId = await createChatroom(sessionId);
    await seedActiveTask(chatroomId);
    await t.run(async (ctx) => {
      await ctx.db.insert('chatroom_messageQueue', {
        chatroomId,
        senderRole: 'user',
        content: 'at-zero',
        type: 'message',
        queuePosition: 0,
      });
      await ctx.db.patch('chatroom_rooms', chatroomId, { nextQueuePosition: undefined });
    });
    await t.mutation(api.messages.enqueueMessageAtFront, {
      sessionId,
      chatroomId,
      content: 'new-front',
    });
    const queued = await t.query(api.messages.listQueued, { sessionId, chatroomId });
    expect(queued.map((m) => m.content)).toEqual(['new-front', 'at-zero']);
    expect(queued[0]!.queuePosition).toBe(0);
    expect(queued[1]!.queuePosition).toBe(1);
    const counter = await t.run(
      async (ctx) => (await ctx.db.get('chatroom_rooms', chatroomId))?.nextQueuePosition
    );
    expect(counter).toBe(2);
  });

  test('idle chatroom creates direct pending task, not a queue row', async () => {
    const { sessionId } = await createTestSession('enqueue-front-idle');
    const chatroomId = await createChatroom(sessionId);
    const messageId = await t.mutation(api.messages.enqueueMessageAtFront, {
      sessionId,
      chatroomId,
      content: 'idle message',
    });
    const queued = await t.query(api.messages.listQueued, { sessionId, chatroomId });
    expect(queued).toHaveLength(0);
    const message = await t.run(async (ctx) =>
      ctx.db.get('chatroom_messages', messageId as Id<'chatroom_messages'>)
    );
    expect(message?.content).toBe('idle message');
  });
});

describe('listQueued query', () => {
  test('returns queued messages for a chatroom in creation order', async () => {
    const { sessionId } = await createTestSession('list-queued-1');
    const chatroomId = await createChatroom(sessionId);

    // Seed an active task to trigger queuing behavior
    await seedActiveTask(chatroomId);

    // Send two queued messages
    await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      senderRole: 'user',
      content: 'first queued message',
      type: 'message',
    });

    await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      senderRole: 'user',
      content: 'second queued message',
      type: 'message',
    });

    // Fetch queued messages
    const queuedMessages = await t.query(api.messages.listQueued, {
      sessionId,
      chatroomId,
    });

    expect(queuedMessages.length).toBe(2);
    expect(queuedMessages[0].content).toBe('first queued message');
    expect(queuedMessages[1].content).toBe('second queued message');
    expect(queuedMessages[0].isQueued).toBe(true);
    expect(queuedMessages[1].isQueued).toBe(true);
  });

  test('includes conversationMode in queued message output when set', async () => {
    const { sessionId } = await createTestSession('list-queued-conv-mode');
    const chatroomId = await createChatroom(sessionId);
    await seedActiveTask(chatroomId);

    await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      senderRole: 'user',
      content: 'queued with mode',
      type: 'message',
      conversationMode: 'code:enhanced',
    });

    const queuedMessages = await t.query(api.messages.listQueued, {
      sessionId,
      chatroomId,
    });

    expect(queuedMessages.length).toBe(1);
    expect(queuedMessages[0].conversationMode).toBe('code:enhanced');
  });

  test('returns empty array when no queued messages exist', async () => {
    const { sessionId } = await createTestSession('list-queued-2');
    const chatroomId = await createChatroom(sessionId);

    // No queued messages - chatroom is empty
    const queuedMessages = await t.query(api.messages.listQueued, {
      sessionId,
      chatroomId,
    });

    expect(queuedMessages).toEqual([]);
  });

  test('does not return messages from chatroom_messages table', async () => {
    const { sessionId } = await createTestSession('list-queued-3');
    const chatroomId = await createChatroom(sessionId);

    // Send a regular message (no active tasks, so it goes to chatroom_messages)
    await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      senderRole: 'user',
      content: 'regular message',
      type: 'message',
    });

    // Fetch queued messages (should be empty)
    const queuedMessages = await t.query(api.messages.listQueued, {
      sessionId,
      chatroomId,
    });

    expect(queuedMessages).toEqual([]);
  });
});

describe('_handoffHandler — queued task promotion on handoff-to-user', () => {
  test('builder→planner handoff sets sender waiting and creates pending target task', async () => {
    const { sessionId } = await createTestSession('handoff-sender-waiting');
    const chatroomId = await createChatroom(sessionId);
    await joinParticipants(sessionId, chatroomId, ['planner', 'builder']);

    const builderTaskId = await t.run(async (ctx) => {
      const now = Date.now();
      return await ctx.db.insert('chatroom_tasks', {
        chatroomId,
        createdBy: 'planner',
        content: 'builder work',
        status: 'in_progress',
        createdAt: now,
        updatedAt: now,
        queuePosition: 0,
        assignedTo: 'builder',
        startedAt: now,
        acknowledgedAt: now,
      });
    });

    await t.run(async (ctx) => {
      const participant = await ctx.db
        .query('chatroom_participants')
        .withIndex('by_chatroom_and_role', (q) =>
          q.eq('chatroomId', chatroomId).eq('role', 'builder')
        )
        .unique();
      if (participant) {
        await ctx.db.patch('chatroom_participants', participant._id, {
          lastStatus: 'task.inProgress',
          lastInFlightTaskId: builderTaskId,
        });
      }
    });

    const result = await t.mutation(api.messages.handoff, {
      sessionId,
      chatroomId,
      senderRole: 'builder',
      content: 'work done',
      targetRole: 'planner',
    });

    expect(result.success).toBe(true);
    expect(result.newTaskId).toBeTruthy();
    expect(result.completedTaskIds).toContain(builderTaskId);

    const plannerTask = await t.run(async (ctx) => ctx.db.get('chatroom_tasks', result.newTaskId!));
    expect(plannerTask?.status).toBe('pending');
    expect(plannerTask?.assignedTo).toBe('planner');

    const readModel = await t.run(async (ctx) =>
      ctx.db
        .query('chatroom_agentRoleStatusReadModel')
        .withIndex('by_chatroom_role', (q) => q.eq('chatroomId', chatroomId).eq('role', 'builder'))
        .first()
    );
    expect(readModel?.status).toBe('waiting');

    const participant = await t.run(async (ctx) =>
      ctx.db
        .query('chatroom_participants')
        .withIndex('by_chatroom_and_role', (q) =>
          q.eq('chatroomId', chatroomId).eq('role', 'builder')
        )
        .unique()
    );
    expect(participant?.lastStatus).toBe('agent.waiting');
    expect(participant?.lastInFlightTaskId).toBeUndefined();
  });

  test('when handing off to user and queued tasks exist, promotes first queued task to pending', async () => {
    const { sessionId } = await createTestSession('handoff-promote-1');
    const chatroomId = await createChatroom(sessionId);

    // Create an in_progress task for the builder (will be completed by handoff)
    const activeTaskId = await t.run(async (ctx) => {
      const now = Date.now();
      return await ctx.db.insert('chatroom_tasks', {
        chatroomId,
        createdBy: 'user',
        content: 'task in progress',
        status: 'in_progress',
        createdAt: now,
        updatedAt: now,
        queuePosition: 0,
        assignedTo: 'builder',
      });
    });

    // Send a user message while the builder is working (should be queued)
    await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      senderRole: 'user',
      content: 'queued message',
      type: 'message',
    });

    // Verify the message was queued
    const queuedBefore = await t.query(api.messages.listQueued, {
      sessionId,
      chatroomId,
    });
    expect(queuedBefore.length).toBe(1);

    // Mark the active task as having a sourceMessageId (simulate classify)
    await t.run(async (ctx) => {
      const msg = await ctx.db
        .query('chatroom_messages')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .filter((q) => q.eq(q.field('content'), 'task in progress'))
        .first();
      if (msg) {
        await ctx.db.patch(activeTaskId, { sourceMessageId: msg._id });
      }
    });

    // Builder hands off to user (should complete the task + promote queued task)
    const result = await t.mutation(api.messages.handoff, {
      sessionId,
      chatroomId,
      senderRole: 'builder',
      content: 'work complete',
      targetRole: 'user',
    });

    // Verify promotion happened
    expect(result.success).toBe(true);
    expect(result.promotedTaskId).toBeDefined();

    // Verify the queued message is now promoted to chatroom_messages
    const queuedAfter = await t.query(api.messages.listQueued, {
      sessionId,
      chatroomId,
    });
    expect(queuedAfter.length).toBe(0);

    // Verify the task status is now pending
    const promotedTask = await t.run(async (ctx) => {
      return await ctx.db.get(result.promotedTaskId!);
    });
    expect(promotedTask?.status).toBe('pending');
  });

  test('handoff-to-user promotes queue after handoff message so All-tab slice ordering is correct', async () => {
    const { sessionId } = await createTestSession('handoff-promote-order');
    const chatroomId = await createChatroom(sessionId);

    const activeTaskId = await t.run(async (ctx) => {
      const now = Date.now();
      return await ctx.db.insert('chatroom_tasks', {
        chatroomId,
        createdBy: 'user',
        content: 'task in progress',
        status: 'in_progress',
        createdAt: now,
        updatedAt: now,
        queuePosition: 0,
        assignedTo: 'builder',
      });
    });

    await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      senderRole: 'user',
      content: 'queued message',
      type: 'message',
    });

    await t.run(async (ctx) => {
      const msg = await ctx.db
        .query('chatroom_messages')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .filter((q) => q.eq(q.field('content'), 'task in progress'))
        .first();
      if (msg) await ctx.db.patch(activeTaskId, { sourceMessageId: msg._id });
    });

    const result = await t.mutation(api.messages.handoff, {
      sessionId,
      chatroomId,
      senderRole: 'builder',
      content: 'work complete',
      targetRole: 'user',
    });

    expect(result.success).toBe(true);
    expect(result.messageId).toBeTruthy();
    expect(result.promotedTaskId).toBeTruthy();

    const { handoffMsg, promotedUserMsg } = await t.run(async (ctx) => {
      const handoff = await ctx.db.get('chatroom_messages', result.messageId!);
      const promotedTask = await ctx.db.get('chatroom_tasks', result.promotedTaskId!);
      const promotedUser = promotedTask?.sourceMessageId
        ? await ctx.db.get('chatroom_messages', promotedTask.sourceMessageId)
        : null;
      return { handoffMsg: handoff, promotedUserMsg: promotedUser };
    });

    expect(handoffMsg?.type).toBe('handoff');
    expect(promotedUserMsg?.senderRole).toBe('user');
    expect(promotedUserMsg?.content).toBe('queued message');
    expect(handoffMsg!._creationTime).toBeLessThan(promotedUserMsg!._creationTime);
  });

  test('when handing off to user and no queued tasks, no promotion happens', async () => {
    const { sessionId } = await createTestSession('handoff-promote-2');
    const chatroomId = await createChatroom(sessionId);

    // Create an in_progress task for the builder (will be completed by handoff)
    const activeTaskId = await t.run(async (ctx) => {
      const now = Date.now();
      return await ctx.db.insert('chatroom_tasks', {
        chatroomId,
        createdBy: 'user',
        content: 'task in progress',
        status: 'in_progress',
        createdAt: now,
        updatedAt: now,
        queuePosition: 0,
        assignedTo: 'builder',
      });
    });

    // Mark the active task as having a sourceMessageId (simulate classify)
    await t.run(async (ctx) => {
      const msg = await ctx.db
        .query('chatroom_messages')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .filter((q) => q.eq(q.field('content'), 'task in progress'))
        .first();
      if (msg) {
        await ctx.db.patch(activeTaskId, { sourceMessageId: msg._id });
      }
    });

    // Builder hands off to user (no queued tasks to promote)
    const result = await t.mutation(api.messages.handoff, {
      sessionId,
      chatroomId,
      senderRole: 'builder',
      content: 'work complete',
      targetRole: 'user',
    });

    // Verify no promotion happened
    expect(result.success).toBe(true);
    expect(result.promotedTaskId).toBeNull();
  });

  test('when handing off to planner with queued user message, does not promote queue', async () => {
    const { sessionId } = await createTestSession('handoff-promote-3');
    const chatroomId = await createChatroom(sessionId);

    // Create an in_progress task for the builder (will be completed by handoff)
    const activeTaskId = await t.run(async (ctx) => {
      const now = Date.now();
      return await ctx.db.insert('chatroom_tasks', {
        chatroomId,
        createdBy: 'user',
        content: 'task in progress',
        status: 'in_progress',
        createdAt: now,
        updatedAt: now,
        queuePosition: 0,
        assignedTo: 'builder',
      });
    });

    // Send a user message while the builder is working (should be queued)
    await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      senderRole: 'user',
      content: 'queued message',
      type: 'message',
    });

    // Verify the message was queued
    const queuedBefore = await t.query(api.messages.listQueued, {
      sessionId,
      chatroomId,
    });
    expect(queuedBefore.length).toBe(1);

    // Mark the active task as having a sourceMessageId (simulate classify)
    await t.run(async (ctx) => {
      const msg = await ctx.db
        .query('chatroom_messages')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .filter((q) => q.eq(q.field('content'), 'task in progress'))
        .first();
      if (msg) {
        await ctx.db.patch(activeTaskId, { sourceMessageId: msg._id });
      }
    });

    // Builder hands off to reviewer (agent-to-agent handoff)
    const result = await t.mutation(api.messages.handoff, {
      sessionId,
      chatroomId,
      senderRole: 'builder',
      content: 'ready for review',
      targetRole: 'planner',
    });

    expect(result.success).toBe(true);
    expect(result.promotedTaskId).toBeNull();
    expect(result.newTaskId).toBeTruthy();

    const queuedAfter = await t.query(api.messages.listQueued, {
      sessionId,
      chatroomId,
    });
    expect(queuedAfter.length).toBe(1);

    const handoffTask = await t.run(async (ctx) => ctx.db.get(result.newTaskId!));
    expect(handoffTask?.status).toBe('pending');
    expect(handoffTask?.assignedTo).toBe('planner');
  });
});

describe('_handoffHandler — envelope propagation across agent handoffs', () => {
  async function seedTaskWithEnvelope(
    chatroomId: Id<'chatroom_rooms'>,
    opts: {
      assignedTo: string;
      createdBy: string;
      content: string;
      queuePosition: number;
      taskEnvelope?: TaskEnvelopeV1;
      conversationMode?: 'chat' | 'code' | 'code:enhanced';
      plannerEnhancerEnabled?: boolean;
      startInNewSession?: boolean;
    }
  ): Promise<Id<'chatroom_tasks'>> {
    return await t.run(async (ctx) => {
      const now = Date.now();
      return await ctx.db.insert('chatroom_tasks', {
        chatroomId,
        createdBy: opts.createdBy,
        content: opts.content,
        status: 'in_progress',
        createdAt: now,
        updatedAt: now,
        queuePosition: opts.queuePosition,
        assignedTo: opts.assignedTo,
        startedAt: now,
        acknowledgedAt: now,
        ...(opts.taskEnvelope !== undefined ? { taskEnvelope: opts.taskEnvelope } : {}),
        ...(opts.conversationMode !== undefined ? { conversationMode: opts.conversationMode } : {}),
        ...(opts.plannerEnhancerEnabled !== undefined
          ? { plannerEnhancerEnabled: opts.plannerEnhancerEnabled }
          : {}),
        ...(opts.startInNewSession !== undefined
          ? { startInNewSession: opts.startInNewSession }
          : {}),
      });
    });
  }

  test('agent handoff inherits and advances the exact sender task envelope', async () => {
    const { sessionId } = await createTestSession('handoff-envelope-basic');
    const chatroomId = await createChatroom(sessionId);
    await joinParticipants(sessionId, chatroomId, ['planner', 'builder']);

    const sourceEnvelope = {
      version: 1 as const,
      conversationMode: 'code' as const,
      sessionPolicy: 'new' as const,
      handoffWorkflow: { preset: 'team' as const, phase: 'entry' as const },
    };
    const builderTaskId = await seedTaskWithEnvelope(chatroomId, {
      assignedTo: 'builder',
      createdBy: 'planner',
      content: 'builder work',
      queuePosition: 0,
      taskEnvelope: sourceEnvelope,
    });

    const result = await t.mutation(api.messages.handoff, {
      sessionId,
      chatroomId,
      senderRole: 'builder',
      content: 'handed to planner',
      targetRole: 'planner',
    });

    expect(result.success).toBe(true);
    expect(result.completedTaskIds).toContain(builderTaskId);

    const plannerTask = await t.run(async (ctx) => ctx.db.get(result.newTaskId!));
    // Full copied + advanced envelope: team/entry -> team/implementation, session preserved.
    expect(plannerTask?.taskEnvelope).toEqual({
      version: 1,
      conversationMode: 'code',
      sessionPolicy: 'new',
      handoffWorkflow: { preset: 'team', phase: 'implementation' },
    });
    // Temporary compatibility projections derived from the inherited envelope.
    expect(plannerTask?.conversationMode).toBe('code');
    expect(plannerTask?.plannerEnhancerEnabled).toBe(false);
    expect(plannerTask?.startInNewSession).toBe(true);

    // The source task envelope is untouched.
    const sourceTask = await t.run(async (ctx) => ctx.db.get(builderTaskId));
    expect(sourceTask?.taskEnvelope).toEqual(sourceEnvelope);
  });

  test('sender-task selection is exact when multiple active tasks exist', async () => {
    const { sessionId } = await createTestSession('handoff-envelope-multi');
    const chatroomId = await createChatroom(sessionId);
    await joinParticipants(sessionId, chatroomId, ['planner', 'builder']);

    const builderEnvelope = {
      version: 1 as const,
      conversationMode: 'code:enhanced' as const,
      sessionPolicy: 'continue' as const,
      handoffWorkflow: { preset: 'enhanced-team' as const, phase: 'entry' as const },
    };
    const unrelatedEnvelope = {
      version: 1 as const,
      conversationMode: 'chat' as const,
      sessionPolicy: 'new' as const,
      handoffWorkflow: { preset: 'direct' as const, phase: 'entry' as const },
    };
    await seedTaskWithEnvelope(chatroomId, {
      assignedTo: 'builder',
      createdBy: 'planner',
      content: 'builder work',
      queuePosition: 0,
      taskEnvelope: builderEnvelope,
    });
    // Unrelated active task for a different role with a different envelope.
    await seedTaskWithEnvelope(chatroomId, {
      assignedTo: 'planner',
      createdBy: 'builder',
      content: 'unrelated planner work',
      queuePosition: 1,
      taskEnvelope: unrelatedEnvelope,
    });

    const result = await t.mutation(api.messages.handoff, {
      sessionId,
      chatroomId,
      senderRole: 'builder',
      content: 'handed to planner',
      targetRole: 'planner',
    });
    expect(result.success).toBe(true);

    const plannerTask = await t.run(async (ctx) => ctx.db.get(result.newTaskId!));
    // Inherited from the builder task (enhanced-team/entry -> enhancement), not the unrelated chat task.
    expect(plannerTask?.taskEnvelope?.handoffWorkflow).toEqual({
      preset: 'enhanced-team',
      phase: 'enhancement',
    });
    expect(plannerTask?.taskEnvelope?.conversationMode).toBe('code:enhanced');
    expect(plannerTask?.taskEnvelope?.sessionPolicy).toBe('continue');
    expect(plannerTask?.plannerEnhancerEnabled).toBe(true);
    expect(plannerTask?.startInNewSession).toBe(false);
  });

  test('legacy sender task without envelope is normalized and advanced on handoff', async () => {
    const { sessionId } = await createTestSession('handoff-envelope-legacy');
    const chatroomId = await createChatroom(sessionId);
    await joinParticipants(sessionId, chatroomId, ['planner', 'builder']);

    const builderTaskId = await seedTaskWithEnvelope(chatroomId, {
      assignedTo: 'builder',
      createdBy: 'planner',
      content: 'builder work',
      queuePosition: 0,
      conversationMode: 'chat',
      plannerEnhancerEnabled: false,
      startInNewSession: true,
    });

    const result = await t.mutation(api.messages.handoff, {
      sessionId,
      chatroomId,
      senderRole: 'builder',
      content: 'handed to planner',
      targetRole: 'planner',
    });
    expect(result.success).toBe(true);

    const plannerTask = await t.run(async (ctx) => ctx.db.get(result.newTaskId!));
    // chat + startInNewSession:true -> normalized envelope (direct/entry),
    // advanced one step to direct/delivery, session policy new preserved.
    expect(plannerTask?.taskEnvelope).toEqual({
      version: 1,
      conversationMode: 'chat',
      sessionPolicy: 'new',
      handoffWorkflow: { preset: 'direct', phase: 'delivery' },
    });
    expect(plannerTask?.conversationMode).toBe('chat');
    expect(plannerTask?.plannerEnhancerEnabled).toBe(false);
    expect(plannerTask?.startInNewSession).toBe(true);

    const sourceTask = await t.run(async (ctx) => ctx.db.get(builderTaskId));
    expect(sourceTask?.taskEnvelope).toBeUndefined();
  });
});

describe('deleteUserMessageOrTask and materialized counts', () => {
  test('delete by task removes task and linked user message', async () => {
    const { sessionId } = await createTestSession('del-pending-task-1');
    const chatroomId = await createChatroom(sessionId);

    const messageId = await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      senderRole: 'user',
      content: 'pending message',
      type: 'message',
    });

    const message = await t.run((ctx) => ctx.db.get('chatroom_messages', messageId));
    const taskId = message!.taskId!;

    await t.mutation(api.messages.deleteUserMessageOrTask, { sessionId, type: 'task', taskId });

    const task = await t.run((ctx) => ctx.db.get('chatroom_tasks', taskId));
    expect(task).toBeNull();

    const deletedMessage = await t.run((ctx) => ctx.db.get('chatroom_messages', messageId));
    expect(deletedMessage).toBeNull();

    const counts = await t.query(api.tasks.getTaskCounts, {
      sessionId,
      chatroomId,
    });
    expect(counts.pending).toBe(0);
  });

  test('delete by queued message id removes queue row', async () => {
    const { sessionId } = await createTestSession('del-queued-msg-1');
    const chatroomId = await createChatroom(sessionId);

    await seedActiveTask(chatroomId);

    await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      senderRole: 'user',
      content: 'queued message to delete',
      type: 'message',
    });

    const queued = await t.query(api.messages.listQueued, {
      sessionId,
      chatroomId,
    });
    expect(queued.length).toBe(1);

    await t.mutation(api.messages.deleteUserMessageOrTask, {
      sessionId,
      type: 'message',
      messageId: queued[0]._id,
    });

    const queuedAfter = await t.query(api.messages.listQueued, {
      sessionId,
      chatroomId,
    });
    expect(queuedAfter.length).toBe(0);
  });

  test('delete by message decrements pending count so next send is not queued', async () => {
    const { sessionId } = await createTestSession('del-pending-counts-1');
    const chatroomId = await createChatroom(sessionId);

    const messageId = await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      senderRole: 'user',
      content: 'pending message',
      type: 'message',
    });

    await t.mutation(api.messages.deleteUserMessageOrTask, {
      sessionId,
      type: 'message',
      messageId,
    });

    const counts = await t.query(api.tasks.getTaskCounts, {
      sessionId,
      chatroomId,
    });
    expect(counts.pending).toBe(0);
    expect(counts.acknowledged).toBe(0);
    expect(counts.in_progress).toBe(0);

    await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      senderRole: 'user',
      content: 'second message after delete',
      type: 'message',
    });

    const queued = await t.query(api.messages.listQueued, {
      sessionId,
      chatroomId,
    });
    expect(queued.length).toBe(0);
  });

  test('update by task syncs linked timeline message', async () => {
    const { sessionId } = await createTestSession('update-task-sync-1');
    const chatroomId = await createChatroom(sessionId);

    const messageId = await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      senderRole: 'user',
      content: 'original content',
      type: 'message',
    });

    const message = await t.run((ctx) => ctx.db.get('chatroom_messages', messageId));
    const taskId = message!.taskId!;

    await t.mutation(api.messages.updateUserMessageOrTask, {
      sessionId,
      type: 'task',
      taskId,
      content: 'updated content',
    });

    const task = await t.run((ctx) => ctx.db.get('chatroom_tasks', taskId));
    const updatedMessage = await t.run((ctx) => ctx.db.get('chatroom_messages', messageId));
    expect(task?.content).toBe('updated content');
    expect(updatedMessage?.content).toBe('updated content');
  });
});

describe('getLastUserMessage query', () => {
  async function insertUserMessage(
    sessionId: SessionId,
    chatroomId: Id<'chatroom_rooms'>,
    content: string
  ): Promise<void> {
    await t.run(async (ctx) => {
      await ctx.db.insert('chatroom_messages', {
        chatroomId,
        senderRole: 'user',
        targetRole: 'planner',
        content,
        type: 'message',
      });
    });
    return;
  }

  test('returns the most recent user message with prior user messages', async () => {
    const { sessionId } = await createTestSession('anchor-1');
    const chatroomId = await createChatroom(sessionId);

    await insertUserMessage(sessionId, chatroomId, 'first request');
    await insertUserMessage(sessionId, chatroomId, 'second request');
    await insertUserMessage(sessionId, chatroomId, 'last request');

    const result = await t.query(api.messages.getLastUserMessage, {
      sessionId,
      chatroomId,
    });

    expect(result.last).not.toBeNull();
    expect(result.last!.content).toBe('last request');
    expect(result.prior.map((m) => m.content)).toEqual(['second request', 'first request']);
  });

  test('returns null last and empty prior when no user messages exist', async () => {
    const { sessionId } = await createTestSession('anchor-empty');
    const chatroomId = await createChatroom(sessionId);

    const result = await t.query(api.messages.getLastUserMessage, {
      sessionId,
      chatroomId,
    });

    expect(result).toEqual({ last: null, prior: [] });
  });

  test('priorLimit controls how many prior user messages are returned (max 5)', async () => {
    const { sessionId } = await createTestSession('anchor-prior-limit');
    const chatroomId = await createChatroom(sessionId);

    for (let i = 1; i <= 8; i++) {
      await insertUserMessage(sessionId, chatroomId, `request ${i}`);
    }

    const withPrior = await t.query(api.messages.getLastUserMessage, {
      sessionId,
      chatroomId,
      priorLimit: 2,
    });
    expect(withPrior.last!.content).toBe('request 8');
    expect(withPrior.prior.map((m) => m.content)).toEqual(['request 7', 'request 6']);

    const capped = await t.query(api.messages.getLastUserMessage, {
      sessionId,
      chatroomId,
      priorLimit: 50,
    });
    expect(capped.prior.length).toBe(5);
  });

  test('ignores non-user messages and handoff-type messages', async () => {
    const { sessionId } = await createTestSession('anchor-filter');
    const chatroomId = await createChatroom(sessionId);

    await t.run(async (ctx) => {
      // Non-user agent handoff
      await ctx.db.insert('chatroom_messages', {
        chatroomId,
        senderRole: 'planner',
        targetRole: 'builder',
        content: 'planner handoff',
        type: 'handoff',
      });
      // User handoff-type message
      await ctx.db.insert('chatroom_messages', {
        chatroomId,
        senderRole: 'user',
        targetRole: 'planner',
        content: 'user handoff content',
        type: 'handoff',
      });
    });

    await insertUserMessage(sessionId, chatroomId, 'the actual user request');

    const result = await t.query(api.messages.getLastUserMessage, {
      sessionId,
      chatroomId,
    });

    expect(result.last).not.toBeNull();
    expect(result.last!.content).toBe('the actual user request');
    expect(result.prior).toEqual([]);
  });
});

describe('updateQueuedMessageConversationMode', () => {
  test('sets conversationMode and derives plannerEnhancerEnabled on queue row', async () => {
    const { sessionId } = await createTestSession('update-conv-mode-1');
    const chatroomId = await createChatroom(sessionId);
    await seedActiveTask(chatroomId);

    // Create a queued message
    await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      senderRole: 'user',
      content: 'mode update target',
      type: 'message',
    });

    const queued = await t.query(api.messages.listQueued, { sessionId, chatroomId });
    expect(queued.length).toBe(1);
    const queuedId = queued[0]._id;

    // Update to code:enhanced
    await t.mutation(api.messages.updateQueuedMessageConversationMode, {
      sessionId,
      queuedMessageId: queuedId,
      conversationMode: 'code:enhanced',
    });

    const updated = await t.run(async (ctx) => {
      return await ctx.db.get('chatroom_messageQueue', queuedId);
    });
    expect(updated?.conversationMode).toBe('code:enhanced');
    expect(updated?.plannerEnhancerEnabled).toBe(true);
  });

  test('sets conversationMode=chat derives plannerEnhancerEnabled=false', async () => {
    const { sessionId } = await createTestSession('update-conv-mode-chat');
    const chatroomId = await createChatroom(sessionId);
    await seedActiveTask(chatroomId);

    await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      senderRole: 'user',
      content: 'chat mode target',
      type: 'message',
    });

    const queued = await t.query(api.messages.listQueued, { sessionId, chatroomId });
    const queuedId = queued[0]._id;

    await t.mutation(api.messages.updateQueuedMessageConversationMode, {
      sessionId,
      queuedMessageId: queuedId,
      conversationMode: 'chat',
    });

    const updated = await t.run(async (ctx) => {
      return await ctx.db.get('chatroom_messageQueue', queuedId);
    });
    expect(updated?.conversationMode).toBe('chat');
    expect(updated?.plannerEnhancerEnabled).toBe(false);
  });

  test('rejects invalid conversationMode values', async () => {
    const { sessionId } = await createTestSession('update-conv-mode-invalid');
    const chatroomId = await createChatroom(sessionId);
    await seedActiveTask(chatroomId);

    await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      senderRole: 'user',
      content: 'invalid mode target',
      type: 'message',
    });

    const queued = await t.query(api.messages.listQueued, { sessionId, chatroomId });
    const queuedId = queued[0]._id;

    await expect(
      t.mutation(api.messages.updateQueuedMessageConversationMode, {
        sessionId,
        queuedMessageId: queuedId,
        conversationMode: 'invalid_mode' as 'chat',
      })
    ).rejects.toThrow();
  });

  test('retains backward compatibility: updateQueuedMessagePlannerEnhancer also sets conversationMode', async () => {
    const { sessionId } = await createTestSession('update-backward-compat');
    const chatroomId = await createChatroom(sessionId);
    await seedActiveTask(chatroomId);

    await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      senderRole: 'user',
      content: 'backward compat target',
      type: 'message',
    });

    const queued = await t.query(api.messages.listQueued, { sessionId, chatroomId });
    const queuedId = queued[0]._id;

    // Use the legacy boolean mutation
    await t.mutation(api.messages.updateQueuedMessagePlannerEnhancer, {
      sessionId,
      queuedMessageId: queuedId,
      plannerEnhancerEnabled: true,
    });

    const updated = await t.run(async (ctx) => {
      return await ctx.db.get('chatroom_messageQueue', queuedId);
    });
    expect(updated?.plannerEnhancerEnabled).toBe(true);
    expect(updated?.conversationMode).toBe('code:enhanced');
  });
});

// ---------------------------------------------------------------------------
// updateQueuedMessageEnvelope + legacy queue-setting adapters
// ---------------------------------------------------------------------------

async function seedQueuePolicyRow(
  chatroomId: Id<'chatroom_rooms'>,
  policy?: {
    taskEnvelope?: {
      version: 1;
      conversationMode: 'chat' | 'code' | 'code:enhanced';
      sessionPolicy: 'continue' | 'new';
      handoffWorkflow: { preset: 'direct' | 'team' | 'enhanced-team'; phase: string };
    };
    conversationMode?: 'chat' | 'code' | 'code:enhanced';
    plannerEnhancerEnabled?: boolean;
    startInNewSession?: boolean;
  }
): Promise<Id<'chatroom_messageQueue'>> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert('chatroom_messageQueue', {
      chatroomId,
      senderRole: 'user',
      content: 'policy target',
      type: 'message' as const,
      queuePosition: 1,
      ...(policy?.taskEnvelope !== undefined ? { taskEnvelope: policy.taskEnvelope } : {}),
      ...(policy?.conversationMode !== undefined
        ? { conversationMode: policy.conversationMode }
        : {}),
      ...(policy?.plannerEnhancerEnabled !== undefined
        ? { plannerEnhancerEnabled: policy.plannerEnhancerEnabled }
        : {}),
      ...(policy?.startInNewSession !== undefined
        ? { startInNewSession: policy.startInNewSession }
        : {}),
    });
  });
}

describe('updateQueuedMessageEnvelope', () => {
  test('replaces the complete stored envelope in one atomic patch', async () => {
    const { sessionId } = await createTestSession('queue-env-replace');
    const chatroomId = await createChatroom(sessionId);

    const initial = {
      version: 1 as const,
      conversationMode: 'chat' as const,
      sessionPolicy: 'continue' as const,
      handoffWorkflow: { preset: 'direct' as const, phase: 'entry' as const },
    };
    const queuedId = await seedQueuePolicyRow(chatroomId, { taskEnvelope: initial });

    const replacement = {
      version: 1 as const,
      conversationMode: 'code:enhanced' as const,
      sessionPolicy: 'new' as const,
      handoffWorkflow: { preset: 'enhanced-team' as const, phase: 'entry' as const },
    };
    await t.mutation(api.messages.updateQueuedMessageEnvelope, {
      sessionId,
      queuedMessageId: queuedId,
      taskEnvelope: replacement,
    });

    const row = await t.run((ctx) => ctx.db.get('chatroom_messageQueue', queuedId));
    // Assert the complete stored object, not separate scalar equality only.
    expect(row?.taskEnvelope).toEqual(replacement);
    expect(row?.conversationMode).toBe('code:enhanced');
    expect(row?.plannerEnhancerEnabled).toBe(true);
    expect(row?.startInNewSession).toBe(true);
  });

  test('changing mode from chat to code resets preset/phase and preserves session policy', async () => {
    const { sessionId } = await createTestSession('queue-env-mode-edit');
    const chatroomId = await createChatroom(sessionId);

    const current = {
      version: 1 as const,
      conversationMode: 'chat' as const,
      sessionPolicy: 'new' as const,
      handoffWorkflow: { preset: 'direct' as const, phase: 'entry' as const },
    };
    const queuedId = await seedQueuePolicyRow(chatroomId, { taskEnvelope: current });

    const next = withTaskEnvelopeConversationMode(current, 'code');
    await t.mutation(api.messages.updateQueuedMessageEnvelope, {
      sessionId,
      queuedMessageId: queuedId,
      taskEnvelope: next,
    });

    const row = await t.run((ctx) => ctx.db.get('chatroom_messageQueue', queuedId));
    expect(row?.taskEnvelope).toEqual({
      version: 1,
      conversationMode: 'code',
      sessionPolicy: 'new',
      handoffWorkflow: { preset: 'team', phase: 'entry' },
    });
    expect(row?.conversationMode).toBe('code');
    expect(row?.plannerEnhancerEnabled).toBe(false);
    expect(row?.startInNewSession).toBe(true);
  });

  test('session policy edit preserves mode, preset, and a non-entry phase', async () => {
    const { sessionId } = await createTestSession('queue-env-session-edit');
    const chatroomId = await createChatroom(sessionId);

    const current = {
      version: 1 as const,
      conversationMode: 'code' as const,
      sessionPolicy: 'new' as const,
      handoffWorkflow: { preset: 'team' as const, phase: 'implementation' as const },
    };
    const queuedId = await seedQueuePolicyRow(chatroomId, { taskEnvelope: current });

    const next = withTaskEnvelopeSessionPolicy(current, 'continue');
    await t.mutation(api.messages.updateQueuedMessageEnvelope, {
      sessionId,
      queuedMessageId: queuedId,
      taskEnvelope: next,
    });

    const row = await t.run((ctx) => ctx.db.get('chatroom_messageQueue', queuedId));
    expect(row?.taskEnvelope).toEqual({
      version: 1,
      conversationMode: 'code',
      sessionPolicy: 'continue',
      handoffWorkflow: { preset: 'team', phase: 'implementation' },
    });
    expect(row?.startInNewSession).toBe(false);
  });

  test('updates a legacy queue row without taskEnvelope into a consistent complete state', async () => {
    const { sessionId } = await createTestSession('queue-env-legacy-row');
    const chatroomId = await createChatroom(sessionId);

    const queuedId = await seedQueuePolicyRow(chatroomId, {
      conversationMode: 'chat',
      plannerEnhancerEnabled: false,
      startInNewSession: true,
    });

    const replacement = {
      version: 1 as const,
      conversationMode: 'code' as const,
      sessionPolicy: 'continue' as const,
      handoffWorkflow: { preset: 'team' as const, phase: 'entry' as const },
    };
    await t.mutation(api.messages.updateQueuedMessageEnvelope, {
      sessionId,
      queuedMessageId: queuedId,
      taskEnvelope: replacement,
    });

    const row = await t.run((ctx) => ctx.db.get('chatroom_messageQueue', queuedId));
    expect(row?.taskEnvelope).toEqual(replacement);
    // Scalar projections now derive from the replacement envelope.
    expect(row?.conversationMode).toBe('code');
    expect(row?.plannerEnhancerEnabled).toBe(false);
    expect(row?.startInNewSession).toBe(false);
  });

  test('rejects a semantically inconsistent envelope (chat with team preset)', async () => {
    const { sessionId } = await createTestSession('queue-env-semantic-bad');
    const chatroomId = await createChatroom(sessionId);

    const queuedId = await seedQueuePolicyRow(chatroomId, {
      taskEnvelope: {
        version: 1,
        conversationMode: 'chat',
        sessionPolicy: 'continue',
        handoffWorkflow: { preset: 'direct', phase: 'entry' },
      },
    });

    await expect(
      t.mutation(api.messages.updateQueuedMessageEnvelope, {
        sessionId,
        queuedMessageId: queuedId,
        taskEnvelope: {
          version: 1,
          conversationMode: 'chat',
          sessionPolicy: 'continue',
          handoffWorkflow: { preset: 'team', phase: 'entry' },
        },
      })
    ).rejects.toThrow(/INVALID_TASK_ENVELOPE/);
  });

  test('missing queue row still throws QUEUED_MESSAGE_NOT_FOUND', async () => {
    const { sessionId } = await createTestSession('queue-env-missing');
    const chatroomId = await createChatroom(sessionId);

    const deletedId = await t.run(async (ctx) => {
      const id = await ctx.db.insert('chatroom_messageQueue', {
        chatroomId,
        senderRole: 'user',
        content: 'temp',
        type: 'message' as const,
        queuePosition: 0,
      });
      await ctx.db.delete('chatroom_messageQueue', id);
      return id;
    });

    await expect(
      t.mutation(api.messages.updateQueuedMessageEnvelope, {
        sessionId,
        queuedMessageId: deletedId,
        taskEnvelope: {
          version: 1,
          conversationMode: 'chat',
          sessionPolicy: 'continue',
          handoffWorkflow: { preset: 'direct', phase: 'entry' },
        },
      })
    ).rejects.toThrow(/QUEUED_MESSAGE_NOT_FOUND/);
  });

  test('auth rejects updating a queue row in another chatroom', async () => {
    const { sessionId: ownerSession } = await createTestSession('queue-env-auth-owner');
    const { sessionId: otherSession } = await createTestSession('queue-env-auth-other');
    const chatroomId = await createChatroom(ownerSession);

    const queuedId = await seedQueuePolicyRow(chatroomId, {
      conversationMode: 'chat',
      plannerEnhancerEnabled: false,
    });

    await expect(
      t.mutation(api.messages.updateQueuedMessageEnvelope, {
        sessionId: otherSession,
        queuedMessageId: queuedId,
        taskEnvelope: {
          version: 1,
          conversationMode: 'chat',
          sessionPolicy: 'continue',
          handoffWorkflow: { preset: 'direct', phase: 'entry' },
        },
      })
    ).rejects.toThrow(/ACCESS_DENIED/);
  });
});

describe('legacy queue-setting mutations edit the complete envelope', () => {
  test('updateQueuedMessageConversationMode(chat) rewrites the envelope and scalar projections', async () => {
    const { sessionId } = await createTestSession('queue-adapter-conv-mode');
    const chatroomId = await createChatroom(sessionId);
    await seedActiveTask(chatroomId);

    await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      senderRole: 'user',
      content: 'adapter conv target',
      type: 'message',
    });
    const queued = await t.query(api.messages.listQueued, { sessionId, chatroomId });
    const queuedId = queued[0]!._id;

    await t.mutation(api.messages.updateQueuedMessageConversationMode, {
      sessionId,
      queuedMessageId: queuedId,
      conversationMode: 'chat',
    });

    const row = await t.run((ctx) => ctx.db.get('chatroom_messageQueue', queuedId));
    expect(row?.taskEnvelope).toEqual({
      version: 1,
      conversationMode: 'chat',
      sessionPolicy: 'continue',
      handoffWorkflow: { preset: 'direct', phase: 'entry' },
    });
    expect(row?.conversationMode).toBe('chat');
    expect(row?.plannerEnhancerEnabled).toBe(false);
  });

  test('updateQueuedMessagePlannerEnhancer(false) maps false to code (team), not chat', async () => {
    const { sessionId } = await createTestSession('queue-adapter-plugin-false');
    const chatroomId = await createChatroom(sessionId);
    await seedActiveTask(chatroomId);

    await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      senderRole: 'user',
      content: 'adapter enh false',
      type: 'message',
    });
    const queued = await t.query(api.messages.listQueued, { sessionId, chatroomId });
    const queuedId = queued[0]!._id;

    await t.mutation(api.messages.updateQueuedMessagePlannerEnhancer, {
      sessionId,
      queuedMessageId: queuedId,
      plannerEnhancerEnabled: false,
    });

    const row = await t.run((ctx) => ctx.db.get('chatroom_messageQueue', queuedId));
    expect(row?.taskEnvelope?.conversationMode).toBe('code');
    expect(row?.taskEnvelope?.handoffWorkflow).toEqual({ preset: 'team', phase: 'entry' });
    expect(row?.plannerEnhancerEnabled).toBe(false);
    expect(row?.conversationMode).toBe('code');
  });

  test('updateQueuedMessageStartInNewSession(true) sets sessionPolicy new and projection', async () => {
    const { sessionId } = await createTestSession('queue-adapter-new-session');
    const chatroomId = await createChatroom(sessionId);
    await seedActiveTask(chatroomId);

    await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      senderRole: 'user',
      content: 'adapter new session',
      type: 'message',
    });
    const queued = await t.query(api.messages.listQueued, { sessionId, chatroomId });
    const queuedId = queued[0]!._id;

    await t.mutation(api.messages.updateQueuedMessageStartInNewSession, {
      sessionId,
      queuedMessageId: queuedId,
      startInNewSession: true,
    });

    const row = await t.run((ctx) => ctx.db.get('chatroom_messageQueue', queuedId));
    expect(row?.taskEnvelope?.sessionPolicy).toBe('new');
    expect(row?.startInNewSession).toBe(true);
    // Mode/preset are preserved by the session adapter.
    expect(row?.taskEnvelope?.conversationMode).toBe('code');
    expect(row?.taskEnvelope?.handoffWorkflow?.preset).toBe('team');
  });
});
