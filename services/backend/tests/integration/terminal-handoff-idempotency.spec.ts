/**
 * Terminal handoff idempotency — Integration Tests
 *
 * Verifies repeated handoff-to-user for the same originating user message
 * returns the original message ID without duplicating side effects.
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

async function createUserOriginPlannerTask(
  chatroomId: Id<'chatroom_rooms'>,
  content: string
): Promise<Id<'chatroom_messages'>> {
  return await t.run(async (ctx) => {
    const userMessageId = await ctx.db.insert('chatroom_messages', {
      chatroomId,
      senderRole: 'user',
      content,
      targetRole: 'planner',
      type: 'message',
      acknowledgedAt: Date.now(),
    });
    await ctx.db.insert('chatroom_tasks', {
      chatroomId,
      createdBy: 'user',
      content,
      status: 'in_progress',
      assignedTo: 'planner',
      sourceMessageId: userMessageId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      queuePosition: 1,
    });
    return userMessageId;
  });
}

describe('Terminal handoff idempotency', () => {
  test('repeated handoff-to-user returns same messageId without duplicate side effects', async () => {
    const { sessionId } = await createTestSession('terminal-handoff-idempotent');
    const chatroomId = await createPlannerBuilderDuoChatroom(sessionId);
    await joinParticipant(sessionId, chatroomId, 'planner');
    await joinParticipant(sessionId, chatroomId, 'builder');

    const userMessageId = await createUserOriginPlannerTask(chatroomId, 'Build feature X');

    const plannerToBuilder = await t.mutation(api.messages.handoff, {
      sessionId,
      chatroomId,
      senderRole: 'planner',
      targetRole: 'builder',
      content: 'Delegating to builder.',
    });
    expect(plannerToBuilder.success).toBe(true);

    const handoffContent = 'Done — handing back to user.';
    const first = await t.mutation(api.messages.handoff, {
      sessionId,
      chatroomId,
      senderRole: 'builder',
      targetRole: 'user',
      content: handoffContent,
    });
    expect(first.success).toBe(true);
    expect(first.messageId).toBeTruthy();
    expect(first.completedTaskIds.length).toBeGreaterThan(0);

    const second = await t.mutation(api.messages.handoff, {
      sessionId,
      chatroomId,
      senderRole: 'builder',
      targetRole: 'user',
      content: handoffContent,
    });
    expect(second.success).toBe(true);
    expect(second.messageId).toBe(first.messageId);
    expect(second.completedTaskIds).toEqual([]);
    expect(second.newTaskId).toBeNull();
    expect(second.promotedTaskId).toBeNull();

    const terminalHandoffKey = `${chatroomId}:${userMessageId}:builder:user`;
    const handoffs = await t.run(async (ctx) => {
      const messages = await ctx.db
        .query('chatroom_messages')
        .withIndex('by_chatroom_terminalHandoffKey', (q) =>
          q.eq('chatroomId', chatroomId).eq('terminalHandoffKey', terminalHandoffKey)
        )
        .collect();
      return messages;
    });
    expect(handoffs).toHaveLength(1);
    expect(handoffs[0]!._id).toBe(first.messageId);
    expect(handoffs[0]!.content).toBe(handoffContent);
    expect(handoffs[0]!.taskOriginMessageId).toBe(userMessageId);

    const tasks = await t.run(async (ctx) =>
      ctx.db
        .query('chatroom_tasks')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .collect()
    );
    const completedBuilderTasks = tasks.filter(
      (task) => task.assignedTo === 'builder' && task.status === 'completed'
    );
    expect(completedBuilderTasks).toHaveLength(1);
    expect(
      tasks.filter((task) => task.assignedTo === 'builder' && task.status === 'pending')
    ).toHaveLength(0);
  });

  test('handoff-to-user without resolved origin remains successful and is not deduped', async () => {
    const { sessionId } = await createTestSession('terminal-handoff-no-origin');
    const chatroomId = await createPlannerBuilderDuoChatroom(sessionId);
    await joinParticipant(sessionId, chatroomId, 'planner');

    const { taskId } = await t.mutation(api.tasks.createTask, {
      sessionId,
      chatroomId,
      content: 'Planner pending work without user origin',
      createdBy: 'user',
    });

    await t.run(async (ctx) => {
      await ctx.db.patch('chatroom_tasks', taskId, { assignedTo: 'planner' });
    });

    const first = await t.mutation(api.messages.handoff, {
      sessionId,
      chatroomId,
      senderRole: 'planner',
      targetRole: 'user',
      content: 'Done — handing back to user.',
    });
    expect(first.success).toBe(true);
    expect(first.messageId).toBeTruthy();

    const second = await t.mutation(api.messages.handoff, {
      sessionId,
      chatroomId,
      senderRole: 'planner',
      targetRole: 'user',
      content: 'Done — handing back to user.',
    });
    expect(second.success).toBe(true);
    expect(second.messageId).not.toBe(first.messageId);

    const handoffsWithoutKey = await t.run(async (ctx) => {
      const messages = await ctx.db
        .query('chatroom_messages')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .collect();
      return messages.filter(
        (message) => message.type === 'handoff' && message.targetRole === 'user'
      );
    });
    expect(handoffsWithoutKey).toHaveLength(2);
    expect(handoffsWithoutKey.every((message) => message.terminalHandoffKey === undefined)).toBe(
      true
    );
  });
});
