/**
 * Handoff sender-agent snapshot — Integration Tests
 *
 * Verifies `api.messages.handoff` stores the normalized `{ harness, model? }`
 * snapshot on the handoff row and that every enriched message read path returns
 * it unchanged. Non-handoff rows never carry the field.
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
import { readTimelineMessagesForTest } from '../helpers/timeline';

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

async function readMessageRow(
  chatroomId: Id<'chatroom_rooms'>,
  messageId: Id<'chatroom_messages'>
) {
  const timeline = await readTimelineMessagesForTest(t, chatroomId);
  const row = timeline.find((message) => message._id === messageId);
  if (!row) throw new Error(`message ${messageId} not found in the timeline`);
  return row;
}

describe('handoff sender-agent snapshot', () => {
  test('stores a valid snapshot and returns it from every list read', async () => {
    const { sessionId } = await createTestSession('handoff-sender-agent-valid');
    const chatroomId = await createPlannerBuilderDuoChatroom(sessionId);
    await joinParticipant(sessionId, chatroomId, 'planner');
    await joinParticipant(sessionId, chatroomId, 'builder');

    const earlierMessageId = await t.mutation(api.messages.sendMessage, {
      sessionId: sessionId as any,
      chatroomId,
      senderRole: 'user',
      content: 'before',
      type: 'message',
    });

    const result = await t.mutation(api.messages.handoff, {
      sessionId,
      chatroomId,
      senderRole: 'planner',
      targetRole: 'builder',
      content: 'Delegating to builder.',
      senderAgent: { harness: 'claude-sdk', model: 'anthropic/claude-sonnet-4' },
    });
    expect(result.success).toBe(true);
    expect(result.messageId).toBeTruthy();

    const row = await readMessageRow(chatroomId, result.messageId!);
    expect(row.senderAgent).toStrictEqual({
      harness: 'claude-sdk',
      model: 'anthropic/claude-sonnet-4',
    });

    const pageNav = await t.query(api.conversation.listPages, {
      sessionId,
      chatroomId,
      pageId: earlierMessageId,
    });
    const pageMessages = await t.query(api.conversation.listPageMessages, {
      sessionId,
      chatroomId,
      pageId: earlierMessageId,
      paginationOpts: { numItems: 50, cursor: null },
      endExclusive: pageNav.pages[0]!.endExclusive,
    });
    const pageRow = pageMessages.page.find((message) => message._id === result.messageId);
    expect(pageRow?.senderAgent).toStrictEqual({
      harness: 'claude-sdk',
      model: 'anthropic/claude-sonnet-4',
    });

    const tail = await t.query(api.conversation.subscribePageTail, {
      sessionId,
      chatroomId,
      afterCreationTime: 0,
      endExclusive: pageNav.pages[0]!.endExclusive,
    });
    const tailRow = tail!.find((message) => message._id === result.messageId);
    expect(tailRow?.senderAgent).toStrictEqual({
      harness: 'claude-sdk',
      model: 'anthropic/claude-sonnet-4',
    });
  });

  test('stores a harness-only snapshot without a model key', async () => {
    const { sessionId } = await createTestSession('handoff-sender-agent-harness-only');
    const chatroomId = await createPlannerBuilderDuoChatroom(sessionId);
    await joinParticipant(sessionId, chatroomId, 'planner');
    await joinParticipant(sessionId, chatroomId, 'builder');

    const result = await t.mutation(api.messages.handoff, {
      sessionId,
      chatroomId,
      senderRole: 'planner',
      targetRole: 'builder',
      content: 'Delegating to builder.',
      senderAgent: { harness: 'codex-sdk' },
    });
    expect(result.success).toBe(true);

    const row = await readMessageRow(chatroomId, result.messageId!);
    expect(row.senderAgent).toStrictEqual({ harness: 'codex-sdk' });
  });

  test('omits the field when no snapshot is supplied', async () => {
    const { sessionId } = await createTestSession('handoff-sender-agent-absent');
    const chatroomId = await createPlannerBuilderDuoChatroom(sessionId);
    await joinParticipant(sessionId, chatroomId, 'planner');
    await joinParticipant(sessionId, chatroomId, 'builder');

    const result = await t.mutation(api.messages.handoff, {
      sessionId,
      chatroomId,
      senderRole: 'planner',
      targetRole: 'builder',
      content: 'Delegating to builder.',
    });
    expect(result.success).toBe(true);

    const row = await readMessageRow(chatroomId, result.messageId!);
    expect(row).not.toHaveProperty('senderAgent');
  });

  test('drops an unknown harness without failing the handoff', async () => {
    const { sessionId } = await createTestSession('handoff-sender-agent-unknown');
    const chatroomId = await createPlannerBuilderDuoChatroom(sessionId);
    await joinParticipant(sessionId, chatroomId, 'planner');
    await joinParticipant(sessionId, chatroomId, 'builder');

    const result = await t.mutation(api.messages.handoff, {
      sessionId,
      chatroomId,
      senderRole: 'planner',
      targetRole: 'builder',
      content: 'Delegating to builder.',
      senderAgent: { harness: 'not-a-harness', model: 'x' },
    });
    expect(result.success).toBe(true);

    const row = await readMessageRow(chatroomId, result.messageId!);
    expect(row).not.toHaveProperty('senderAgent');
  });

  test('trims the model and drops an over-long model', async () => {
    const { sessionId } = await createTestSession('handoff-sender-agent-model');
    const chatroomId = await createPlannerBuilderDuoChatroom(sessionId);
    await joinParticipant(sessionId, chatroomId, 'planner');
    await joinParticipant(sessionId, chatroomId, 'builder');

    const trimmed = await t.mutation(api.messages.handoff, {
      sessionId,
      chatroomId,
      senderRole: 'planner',
      targetRole: 'builder',
      content: 'Trimmed model.',
      senderAgent: { harness: 'claude-sdk', model: '  anthropic/claude-sonnet-4  ' },
    });
    expect(trimmed.success).toBe(true);
    const trimmedRow = await readMessageRow(chatroomId, trimmed.messageId!);
    expect(trimmedRow.senderAgent).toStrictEqual({
      harness: 'claude-sdk',
      model: 'anthropic/claude-sonnet-4',
    });

    const overLong = await t.mutation(api.messages.handoff, {
      sessionId,
      chatroomId,
      senderRole: 'planner',
      targetRole: 'builder',
      content: 'Over-long model.',
      senderAgent: { harness: 'claude-sdk', model: 'a'.repeat(201) },
    });
    expect(overLong.success).toBe(true);
    const overLongRow = await readMessageRow(chatroomId, overLong.messageId!);
    expect(overLongRow.senderAgent).toStrictEqual({ harness: 'claude-sdk' });
  });

  test('stores the snapshot on a handoff to the user', async () => {
    const { sessionId } = await createTestSession('handoff-sender-agent-user-target');
    const chatroomId = await createPlannerBuilderDuoChatroom(sessionId);
    await joinParticipant(sessionId, chatroomId, 'planner');
    await joinParticipant(sessionId, chatroomId, 'builder');

    const result = await t.mutation(api.messages.handoff, {
      sessionId,
      chatroomId,
      senderRole: 'builder',
      targetRole: 'user',
      content: 'Done.',
      senderAgent: { harness: 'codex-sdk', model: 'gpt-5-codex' },
    });
    expect(result.success).toBe(true);

    const row = await readMessageRow(chatroomId, result.messageId!);
    expect(row.senderAgent).toStrictEqual({ harness: 'codex-sdk', model: 'gpt-5-codex' });
  });

  test('never writes the field on message or notice rows', async () => {
    const { sessionId } = await createTestSession('handoff-sender-agent-other-types');
    const chatroomId = await createPlannerBuilderDuoChatroom(sessionId);
    await joinParticipant(sessionId, chatroomId, 'planner');
    await joinParticipant(sessionId, chatroomId, 'builder');

    const messageId = await t.mutation(api.messages.sendMessage, {
      sessionId: sessionId as any,
      chatroomId,
      senderRole: 'user',
      content: 'A plain message',
      type: 'message',
    });

    // notifyUser only works while the sender has an active task.
    await t.run(async (ctx) => {
      const now = Date.now();
      const sourceMessageId = await ctx.db.insert('chatroom_messages', {
        chatroomId,
        senderRole: 'user',
        content: 'notice origin',
        targetRole: 'planner',
        type: 'message',
        acknowledgedAt: now,
      });
      await ctx.db.insert('chatroom_tasks', {
        chatroomId,
        createdBy: 'user',
        content: 'notice origin',
        status: 'in_progress',
        assignedTo: 'planner',
        sourceMessageId,
        createdAt: now,
        updatedAt: now,
        queuePosition: 1,
      });
    });

    const notice = await t.mutation(api.messages.notifyUser, {
      sessionId,
      chatroomId,
      senderRole: 'planner',
      content: 'Interim notice',
    });

    const messageRow = await readMessageRow(chatroomId, messageId);
    expect(messageRow).not.toHaveProperty('senderAgent');

    const noticeRow = await readMessageRow(chatroomId, notice.messageId);
    expect(noticeRow).not.toHaveProperty('senderAgent');
  });

  test('terminal replay keeps the first snapshot', async () => {
    const { sessionId } = await createTestSession('handoff-sender-agent-replay');
    const chatroomId = await createPlannerBuilderDuoChatroom(sessionId);
    await joinParticipant(sessionId, chatroomId, 'planner');
    await joinParticipant(sessionId, chatroomId, 'builder');

    await createUserOriginPlannerTask(chatroomId, 'Build feature X');

    const plannerToBuilder = await t.mutation(api.messages.handoff, {
      sessionId,
      chatroomId,
      senderRole: 'planner',
      targetRole: 'builder',
      content: 'Delegating to builder.',
    });
    expect(plannerToBuilder.success).toBe(true);

    const first = await t.mutation(api.messages.handoff, {
      sessionId,
      chatroomId,
      senderRole: 'builder',
      targetRole: 'user',
      content: 'Done — handing back to user.',
      senderAgent: { harness: 'claude-sdk', model: 'first-model' },
    });
    expect(first.success).toBe(true);
    expect(first.messageId).toBeTruthy();

    const retry = await t.mutation(api.messages.handoff, {
      sessionId,
      chatroomId,
      senderRole: 'builder',
      targetRole: 'user',
      content: 'Done — handing back to user.',
      senderAgent: { harness: 'codex-sdk', model: 'second-model' },
    });
    expect(retry.success).toBe(true);
    expect(retry.messageId).toBe(first.messageId);

    const row = await readMessageRow(chatroomId, first.messageId!);
    expect(row.senderAgent).toStrictEqual({ harness: 'claude-sdk', model: 'first-model' });
  });
});
