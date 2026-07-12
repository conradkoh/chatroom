/**
 * Integration tests for paginated filtered-message-view queries.
 */
import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { t } from '../test.setup';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';

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
    teamEntryPoint: 'planner',
  });
}

async function insertTimelineMessage(
  chatroomId: Id<'chatroom_rooms'>,
  senderRole: string,
  content: string,
  extra?: {
    classification?: 'question' | 'new_feature' | 'follow_up';
    type?: 'message' | 'handoff' | 'join' | 'progress';
  }
): Promise<Id<'chatroom_messages'>> {
  return await t.run(async (ctx) => {
    return (await ctx.db.insert('chatroom_messages', {
      chatroomId,
      senderRole,
      content,
      type: extra?.type ?? 'message',
      ...(extra?.classification ? { classification: extra.classification } : {}),
    })) as Id<'chatroom_messages'>;
  });
}

describe('listUserMessagesPaginated', () => {
  test('returns only user messages, newest first', async () => {
    const { sessionId } = await createTestSession('pag-user-1');
    const chatroomId = await createChatroom(sessionId);
    await insertTimelineMessage(chatroomId, 'user', 'u1');
    await insertTimelineMessage(chatroomId, 'builder', 'b1');
    await insertTimelineMessage(chatroomId, 'user', 'u2');

    const result = await t.query(api.messages.listUserMessagesPaginated, {
      sessionId,
      chatroomId,
      paginationOpts: { numItems: 10, cursor: null },
    });

    expect(result.page).toHaveLength(2);
    expect(result.page.every((m) => m.senderRole === 'user')).toBe(true);
    expect(result.page[0].content).toBe('u2');
  });
});

describe('listMessagesBySenderRolePaginated', () => {
  test('returns planner handoffs and messages, newest first', async () => {
    const { sessionId } = await createTestSession('pag-role-1');
    const chatroomId = await createChatroom(sessionId);
    await insertTimelineMessage(chatroomId, 'planner', 'planner msg', { type: 'message' });
    await insertTimelineMessage(chatroomId, 'planner', 'planner handoff', { type: 'handoff' });
    await insertTimelineMessage(chatroomId, 'builder', 'builder msg');
    await insertTimelineMessage(chatroomId, 'planner', 'older planner', { type: 'message' });

    const result = await t.query(api.messages.listMessagesBySenderRolePaginated, {
      sessionId,
      chatroomId,
      senderRole: 'planner',
      paginationOpts: { numItems: 10, cursor: null },
    });

    expect(result.page).toHaveLength(3);
    expect(result.page.every((m) => m.senderRole === 'planner')).toBe(true);
    const contents = result.page.map((m) => m.content);
    expect(contents).toEqual(
      expect.arrayContaining(['planner msg', 'planner handoff', 'older planner'])
    );
    expect(result.page.map((m) => m.type)).toEqual(expect.arrayContaining(['message', 'handoff']));
  });
});

describe('listConversationSlicePaginated', () => {
  test('slice from anchor until before next user message', async () => {
    const { sessionId } = await createTestSession('pag-slice-1');
    const chatroomId = await createChatroom(sessionId);
    const anchorId = await insertTimelineMessage(chatroomId, 'user', 'anchor');
    await insertTimelineMessage(chatroomId, 'builder', 'reply1');
    await insertTimelineMessage(chatroomId, 'planner', 'reply2');
    await insertTimelineMessage(chatroomId, 'user', 'next user');

    const result = await t.query(api.messages.listConversationSlicePaginated, {
      sessionId,
      chatroomId,
      anchorMessageId: anchorId as Id<'chatroom_messages'>,
      paginationOpts: { numItems: 10, cursor: null },
    });

    expect(result.sliceMetadata.nextUserMessageId).toBeDefined();
    const contents = result.page.map((m) => m.content);
    expect(contents).toContain('anchor');
    expect(contents).toContain('reply1');
    expect(contents).toContain('reply2');
    expect(contents).not.toContain('next user');
  });

  test('follow_up user message ends previous slice', async () => {
    const { sessionId } = await createTestSession('pag-slice-2');
    const chatroomId = await createChatroom(sessionId);
    const anchorId = await insertTimelineMessage(chatroomId, 'user', 'anchor');
    await insertTimelineMessage(chatroomId, 'builder', 'work');
    await insertTimelineMessage(chatroomId, 'user', 'follow up', {
      classification: 'follow_up',
    });

    const result = await t.query(api.messages.listConversationSlicePaginated, {
      sessionId,
      chatroomId,
      anchorMessageId: anchorId as Id<'chatroom_messages'>,
      paginationOpts: { numItems: 10, cursor: null },
    });

    const contents = result.page.map((m) => m.content);
    expect(contents).toContain('anchor');
    expect(contents).toContain('work');
    expect(contents).not.toContain('follow up');
  });
});
