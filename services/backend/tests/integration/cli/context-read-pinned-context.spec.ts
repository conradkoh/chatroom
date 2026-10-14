/**
 * Context Read — Pinned Context Integration Test
 *
 * Verifies that `getContextForRole` always includes the current pinned
 * context from `chatroom_contexts`, even when the message history is empty
 * (e.g., all messages are filtered out due to pending/acknowledged task status).
 *
 * This test was written TDD-style: first written to reproduce the bug where
 * `context read` returned "No context available" despite a context being pinned.
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { api } from '../../../convex/_generated/api';
import type { Doc, Id } from '../../../convex/_generated/dataModel';
import { upsertMessageReadModel } from '../../../src/domain/usecase/message/message-read-model';
import { transitionTask } from '../../../src/domain/usecase/task/transition-task';
import { t } from '../../../test.setup';

/**
 * Helper to create a test session and authenticate
 */
async function createTestSession(sessionId: string): Promise<{ sessionId: SessionId }> {
  const login = await t.mutation(api.auth.loginAnon, {
    sessionId: sessionId as SessionId,
  });
  expect(login.success).toBe(true);
  return { sessionId: sessionId as SessionId };
}

/**
 * Helper to create a duo planner chatroom (planner can create contexts)
 */
async function createDuoPlannerChatroom(sessionId: SessionId): Promise<Id<'chatroom_rooms'>> {
  const chatroomId = await t.mutation(api.chatrooms.create, {
    sessionId,
    teamId: 'duo',
    teamName: 'Duo Team',
    teamRoles: ['planner', 'builder'],
    teamEntryPoint: 'planner',
  });
  return chatroomId;
}

/**
 * Helper to join participants
 */
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
    });
  }
}

describe('Context Read — Pinned Context', () => {
  test('includes pinned context in response even when no messages exist', async () => {
    // ===== SETUP =====
    const { sessionId } = await createTestSession('test-pinned-context-no-messages');
    const chatroomId = await createDuoPlannerChatroom(sessionId);
    await joinParticipants(sessionId, chatroomId, ['planner', 'builder']);

    // Create a context (this pins it to the chatroom)
    await t.mutation(api.contexts.createContext, {
      sessionId,
      chatroomId,
      content: 'Working on the login feature refactor',
      role: 'planner',
    });

    // ===== QUERY CONTEXT =====
    const context = await t.query(api.messages.getContextForRole, {
      sessionId,
      chatroomId,
      role: 'planner',
    });

    // ===== ASSERTIONS =====
    // The response should include the pinned context, even though the
    // message history only has a system "new-context" notification
    expect(context.currentContext).toBeDefined();
    expect(context.currentContext?.content).toBe('Working on the login feature refactor');
    expect(context.currentContext?.createdBy).toBe('planner');
  });

  test('includes pinned context even when all messages are filtered out', async () => {
    // ===== SETUP =====
    const { sessionId } = await createTestSession('test-pinned-context-all-filtered');
    const chatroomId = await createDuoPlannerChatroom(sessionId);
    await joinParticipants(sessionId, chatroomId, ['planner', 'builder']);

    // Create a context
    await t.mutation(api.contexts.createContext, {
      sessionId,
      chatroomId,
      content: 'Fixing authentication flow',
      role: 'planner',
    });

    // User sends a message (creates a pending task for planner)
    await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      senderRole: 'user',
      content: 'Can you fix the auth flow?',
      type: 'message',
    });

    // At this point, the user message has a pending task, which gets
    // filtered out by getContextForRole. The only remaining message is
    // the system "new-context" notification.

    // ===== QUERY CONTEXT =====
    const context = await t.query(api.messages.getContextForRole, {
      sessionId,
      chatroomId,
      role: 'planner',
    });

    // ===== ASSERTIONS =====
    // Even if messages array is empty after filtering, the pinned context
    // should always be present in the response
    expect(context.currentContext).toBeDefined();
    expect(context.currentContext?.content).toBe('Fixing authentication flow');
  });

  test('returns null currentContext when no context has been pinned', async () => {
    // ===== SETUP =====
    const { sessionId } = await createTestSession('test-no-pinned-context');
    const chatroomId = await createDuoPlannerChatroom(sessionId);
    await joinParticipants(sessionId, chatroomId, ['planner', 'builder']);

    // ===== QUERY CONTEXT (no context created) =====
    const context = await t.query(api.messages.getContextForRole, {
      sessionId,
      chatroomId,
      role: 'planner',
    });

    // ===== ASSERTIONS =====
    // Should be null when no context is pinned
    expect(context.currentContext).toBeNull();
  });

  test('uses triggerMessageId from pinned context as the message window anchor', async () => {
    // ===== SETUP =====
    const { sessionId } = await createTestSession('test-trigger-message-id-anchor');
    const chatroomId = await createDuoPlannerChatroom(sessionId);
    await joinParticipants(sessionId, chatroomId, ['planner', 'builder']);

    // User sends message A (this will be the anchor)
    const messageAId = await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      senderRole: 'user',
      content: 'Message A: please do the work',
      type: 'message',
    });

    // Planner claims and reads the task from message A
    const claimed = await t.mutation(api.tasks.claimTask, {
      sessionId,
      chatroomId,
      role: 'planner',
    });

    await t.mutation(api.tasks.readTask, {
      sessionId,
      chatroomId,
      role: 'planner',
      taskId: claimed.taskId,
    });

    // Planner creates a context WITH triggerMessageId pointing to message A
    await t.mutation(api.contexts.createContext, {
      sessionId,
      chatroomId,
      content: 'Working on message A task',
      role: 'planner',
      triggerMessageId: messageAId as Id<'chatroom_messages'>,
    });

    // Planner hands off back to user (completing the task)
    await t.mutation(api.messages.handoff, {
      sessionId,
      chatroomId,
      senderRole: 'planner',
      content: 'Done with message A work',
      targetRole: 'user',
    });

    // User sends a NEW message E (a follow-up after message A was handled)
    // This new user message would become the latest acknowledged user message
    // WITHOUT triggerMessageId logic, the heuristic would anchor on this new message instead
    await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      senderRole: 'user',
      content: 'Message E: a follow-up question',
      type: 'message',
    });

    // Planner claims/reads message E's task
    const claimedTaskE = await t.mutation(api.tasks.claimTask, {
      sessionId,
      chatroomId,
      role: 'planner',
    });

    await t.mutation(api.tasks.readTask, {
      sessionId,
      chatroomId,
      role: 'planner',
      taskId: claimedTaskE.taskId,
    });

    // ===== QUERY CONTEXT =====
    // The context still has triggerMessageId = messageA, so messages should start from A
    const context = await t.query(api.messages.getContextForRole, {
      sessionId,
      chatroomId,
      role: 'planner',
    });

    // ===== ASSERTIONS =====
    // With triggerMessageId logic: origin should be message A (from pinned context)
    // Without it: origin would be message E (latest acknowledged user message)
    expect(context.originMessage?._id).toBe(messageAId);

    // Messages should start from message A and include everything since
    const messageContents = context.messages.map((m) => m.content);
    expect(messageContents).toContain('Message A: please do the work');
    expect(messageContents).toContain('Message E: a follow-up question');
  });
});

/**
 * Read-model window tests for `getContextForRole`.
 *
 * The read model no longer stores a denormalized `taskStatus`. These tests pin
 * the behaviour that depended on it:
 *   1. The full 200-row header window still hides pending/acknowledged task
 *      messages, and produces the same output as the pre-change broad fallback.
 *   2. Legacy rows that still carry `taskStatus` keep validating and patching.
 *   3. Task transitions no longer write to the read model.
 */
describe('Context Read — read-model window', () => {
  test('full 200-row header window hides pending/acknowledged tasks and matches the pre-change broad path', async () => {
    const { sessionId } = await createTestSession('test-read-model-window');
    const chatroomId = await createDuoPlannerChatroom(sessionId);
    await joinParticipants(sessionId, chatroomId, ['planner', 'builder']);

    // 205 messages so the 200-row header window excludes the 5 oldest.
    const TOTAL = 205;
    const PENDING_INDEX = 100;
    const ACKNOWLEDGED_INDEX = 101;
    const IN_PROGRESS_INDEX = 102;
    const COMPLETED_INDEX = 103;

    await t.run(async (ctx) => {
      for (let i = 0; i < TOTAL; i++) {
        const messageId = await ctx.db.insert('chatroom_messages', {
          chatroomId,
          senderRole: 'user',
          content: `message-${i}`,
          type: 'message',
        });

        let taskStatus: Doc<'chatroom_tasks'>['status'] | undefined;
        if (i === PENDING_INDEX) taskStatus = 'pending';
        else if (i === ACKNOWLEDGED_INDEX) taskStatus = 'acknowledged';
        else if (i === IN_PROGRESS_INDEX) taskStatus = 'in_progress';
        else if (i === COMPLETED_INDEX) taskStatus = 'completed';

        let taskId: Id<'chatroom_tasks'> | undefined;
        if (taskStatus) {
          taskId = await ctx.db.insert('chatroom_tasks', {
            chatroomId,
            createdBy: 'user',
            content: `task-${i}`,
            status: taskStatus,
            assignedTo: 'planner',
            sourceMessageId: messageId,
            createdAt: i,
            updatedAt: i,
            queuePosition: i,
          });
          await ctx.db.patch('chatroom_messages', messageId, { taskId });
        }

        // Pre-change read-model rows carried the denormalized `taskStatus`.
        // Reproduce that legacy shape so the old broad-path fallback would have
        // been triggered by the two hidden rows below.
        await ctx.db.insert('chatroom_messageReadModels', {
          messageId,
          chatroomId,
          messageCreatedAt: i,
          senderRole: 'user',
          type: 'message',
          isTimeline: true,
          ...(taskId ? { taskId } : {}),
          ...(taskStatus ? { taskStatus } : {}),
        });
      }
    });

    const context = await t.query(api.messages.getContextForRole, {
      sessionId,
      chatroomId,
      role: 'planner',
    });

    const contents = context.messages.map((m) => m.content);
    // The two hidden messages are excluded; everything else in the window is kept.
    expect(contents).not.toContain(`message-${PENDING_INDEX}`);
    expect(contents).not.toContain(`message-${ACKNOWLEDGED_INDEX}`);
    expect(contents).toContain(`message-${IN_PROGRESS_INDEX}`);
    expect(contents).toContain(`message-${COMPLETED_INDEX}`);
    expect(contents).toContain('message-5');
    expect(contents).toContain(`message-${TOTAL - 1}`);
    // 200-window minus the two hidden messages.
    expect(context.messages).toHaveLength(198);
    // Non-hidden task messages still expose their live task on a nested `task`.
    const inProgress = context.messages.find((m) => m.content === `message-${IN_PROGRESS_INDEX}`);
    expect(inProgress?.task?.status).toBe('in_progress');
    expect(inProgress?.task?.content).toBe(`task-${IN_PROGRESS_INDEX}`);
    const completed = context.messages.find((m) => m.content === `message-${COMPLETED_INDEX}`);
    expect(completed?.task?.status).toBe('completed');
    expect(completed?.task?.content).toBe(`task-${COMPLETED_INDEX}`);

    // Reconstruct the pre-change window selection on the same data: skip
    // pending/acknowledged headers, fall back to the broad 200-row query when
    // the header path shortens, then apply the same live-task filter (#7).
    const preChangeIds = await t.run(async (ctx) => {
      const headers = await ctx.db
        .query('chatroom_messageReadModels')
        .withIndex('by_chatroom_createdAt', (q) => q.eq('chatroomId', chatroomId))
        .order('desc')
        .take(200);

      const docs: Doc<'chatroom_messages'>[] = [];
      for (const header of headers) {
        if (header.taskStatus === 'pending' || header.taskStatus === 'acknowledged') continue;
        const message = await ctx.db.get('chatroom_messages', header.messageId);
        if (message) docs.push(message);
      }

      const window =
        docs.length < headers.length
          ? await ctx.db
              .query('chatroom_messages')
              .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
              .order('desc')
              .take(200)
          : docs;
      window.reverse();

      const ids: string[] = [];
      for (const message of window) {
        let status: Doc<'chatroom_tasks'>['status'] | undefined;
        if (message.taskId) {
          const task = await ctx.db.get('chatroom_tasks', message.taskId);
          if (task) status = task.status;
        }
        if (status === 'pending' || status === 'acknowledged') continue;
        ids.push(message._id.toString());
      }
      return ids;
    });

    expect(context.messages.map((m) => m._id)).toEqual(preChangeIds);
  });

  test('patches a legacy read-model row that still carries taskStatus, and the live task still hides it', async () => {
    const { sessionId } = await createTestSession('test-legacy-task-status-row');
    const chatroomId = await createDuoPlannerChatroom(sessionId);
    await joinParticipants(sessionId, chatroomId, ['planner', 'builder']);

    const messageId = await t.run(async (ctx) => {
      const id = await ctx.db.insert('chatroom_messages', {
        chatroomId,
        senderRole: 'user',
        content: 'legacy-row-message',
        type: 'message',
      });
      const taskId = await ctx.db.insert('chatroom_tasks', {
        chatroomId,
        createdBy: 'user',
        content: 'legacy-task',
        status: 'pending',
        assignedTo: 'planner',
        sourceMessageId: id,
        createdAt: 1,
        updatedAt: 1,
        queuePosition: 1,
      });
      await ctx.db.patch('chatroom_messages', id, { taskId });
      // Simulate a row written before the column stopped being populated.
      await ctx.db.insert('chatroom_messageReadModels', {
        messageId: id,
        chatroomId,
        messageCreatedAt: 1,
        senderRole: 'user',
        type: 'message',
        isTimeline: true,
        taskId,
        taskStatus: 'pending',
      });
      return id;
    });

    // Patching through `upsertMessageReadModel` must not throw on the legacy field.
    await t.run(async (ctx) => {
      const message = (await ctx.db.get('chatroom_messages', messageId))!;
      await upsertMessageReadModel(ctx, message);
      const row = await ctx.db
        .query('chatroom_messageReadModels')
        .withIndex('by_messageId', (q) => q.eq('messageId', messageId))
        .first();
      expect(row?.taskId).toBe(message.taskId);
      // patch() merges keys, so the stale value survives untouched (never read).
      expect(row?.taskStatus).toBe('pending');
    });

    const context = await t.query(api.messages.getContextForRole, {
      sessionId,
      chatroomId,
      role: 'planner',
    });
    // The #7 gate reads the live task row (pending) and hides the message.
    expect(context.messages.find((m) => m._id === messageId)).toBeUndefined();
  });

  test('a task transition writes no read-model rows and leaves taskStatus untouched', async () => {
    const { sessionId } = await createTestSession('test-transition-no-read-model-write');
    const chatroomId = await createDuoPlannerChatroom(sessionId);

    const taskId = await t.run(async (ctx) => {
      const messageId = await ctx.db.insert('chatroom_messages', {
        chatroomId,
        senderRole: 'user',
        content: 'transition-message',
        type: 'message',
      });
      const newTaskId = await ctx.db.insert('chatroom_tasks', {
        chatroomId,
        createdBy: 'user',
        content: 'transition-task',
        status: 'pending',
        assignedTo: 'planner',
        sourceMessageId: messageId,
        createdAt: 1,
        updatedAt: 1,
        queuePosition: 1,
      });
      await ctx.db.patch('chatroom_messages', messageId, { taskId: newTaskId });
      const message = (await ctx.db.get('chatroom_messages', messageId))!;
      await upsertMessageReadModel(ctx, message);
      return newTaskId;
    });

    const readModelSnapshot = () =>
      t.run(async (ctx) => {
        const rows = await ctx.db
          .query('chatroom_messageReadModels')
          .withIndex('by_chatroom_createdAt', (q) => q.eq('chatroomId', chatroomId))
          .collect();
        return { count: rows.length, statuses: rows.map((r) => r.taskStatus ?? null) };
      });

    const before = await readModelSnapshot();

    await t.run(async (ctx) => {
      await transitionTask(ctx, taskId, 'acknowledged', 'claimTask', { assignedTo: 'planner' });
    });

    const after = await readModelSnapshot();

    expect(after.count).toBe(before.count);
    expect(after.statuses).toEqual(before.statuses);
    expect(after.statuses.every((status) => status === null)).toBe(true);
  });
});
