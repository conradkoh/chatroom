/**
 * Integration tests for messageList.ts timeline queries.
 *
 * Tests subscribeLatestMessages (reactive window) and listMessagesBefore
 * (imperative load-older) from convex/messageList.ts.
 */

import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import { t } from '../../test.setup';
import { createTestSession, createDuoTeamChatroom, joinParticipant } from '../helpers/integration';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function sendMessages(
  sessionId: string,
  chatroomId: any,
  count: number,
  role = 'builder'
): Promise<void> {
  for (let i = 1; i <= count; i++) {
    await t.mutation(api.messages.sendMessage, {
      sessionId: sessionId as any,
      chatroomId,
      senderRole: role,
      content: `message-${i}`,
      type: 'message',
    });
  }
}

async function sendMessageOfType(
  sessionId: string,
  chatroomId: any,
  type: string,
  role = 'builder'
): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert('chatroom_messages', {
      chatroomId,
      senderRole: role,
      content: `${type} message`,
      type: type as any,
    });
  });
}

// ---------------------------------------------------------------------------
// subscribeLatestMessages
// ---------------------------------------------------------------------------

describe('subscribeLatestMessages', () => {
  test('empty chatroom → empty array', async () => {
    const { sessionId } = await createTestSession('ml-latest-empty-1');
    const chatroomId = await createDuoTeamChatroom(sessionId);

    const result = await t.query(api.messageList.subscribeLatestMessages, {
      sessionId: sessionId as any,
      chatroomId,
      limit: 20,
    });

    expect(result).toHaveLength(0);
  });

  test('returns up to limit messages in ascending chronological order', async () => {
    const { sessionId } = await createTestSession('ml-latest-window-1');
    const chatroomId = await createDuoTeamChatroom(sessionId);
    await joinParticipant(sessionId, chatroomId, 'builder');
    await sendMessages(sessionId, chatroomId, 25);

    const result = await t.query(api.messageList.subscribeLatestMessages, {
      sessionId: sessionId as any,
      chatroomId,
      limit: 20,
    });

    expect(result).toHaveLength(20);
    expect(result[0]!.content).toBe('message-6');
    expect(result[19]!.content).toBe('message-25');
  });

  test('filters out join and progress message types', async () => {
    const { sessionId } = await createTestSession('ml-latest-filter-1');
    const chatroomId = await createDuoTeamChatroom(sessionId);
    await joinParticipant(sessionId, chatroomId, 'builder');

    await sendMessages(sessionId, chatroomId, 3);
    await sendMessageOfType(sessionId, chatroomId, 'join');
    await sendMessageOfType(sessionId, chatroomId, 'progress');

    const result = await t.query(api.messageList.subscribeLatestMessages, {
      sessionId: sessionId as any,
      chatroomId,
      limit: 20,
    });

    expect(result).toHaveLength(3);
    for (const msg of result) {
      expect(msg.type).not.toBe('join');
      expect(msg.type).not.toBe('progress');
    }
  });

  test('rejects access from unauthenticated session', async () => {
    const { sessionId } = await createTestSession('ml-latest-auth-1');
    const chatroomId = await createDuoTeamChatroom(sessionId);

    await expect(
      t.query(api.messageList.subscribeLatestMessages, {
        sessionId: 'invalid-session' as any,
        chatroomId,
        limit: 20,
      })
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// listMessagesBefore
// ---------------------------------------------------------------------------

describe('listMessagesBefore', () => {
  test('before future timestamp → empty array', async () => {
    const { sessionId } = await createTestSession('ml-before-empty-1');
    const chatroomId = await createDuoTeamChatroom(sessionId);

    const result = await t.query(api.messageList.listMessagesBefore, {
      sessionId: sessionId as any,
      chatroomId,
      before: Date.now() + 60_000,
      limit: 20,
    });

    expect(result).toHaveLength(0);
  });

  test('returns messages strictly before cursor in ascending order', async () => {
    const { sessionId } = await createTestSession('ml-before-page-1');
    const chatroomId = await createDuoTeamChatroom(sessionId);
    await joinParticipant(sessionId, chatroomId, 'builder');
    await sendMessages(sessionId, chatroomId, 25);

    const latest = await t.query(api.messageList.subscribeLatestMessages, {
      sessionId: sessionId as any,
      chatroomId,
      limit: 20,
    });
    expect(latest).toHaveLength(20);

    const before = latest[0]!._creationTime;
    const older = await t.query(api.messageList.listMessagesBefore, {
      sessionId: sessionId as any,
      chatroomId,
      before,
      limit: 20,
    });

    expect(older).toHaveLength(5);
    expect(older[0]!.content).toBe('message-1');
    expect(older[4]!.content).toBe('message-5');
  });

  test('second page returns remaining older messages', async () => {
    const { sessionId } = await createTestSession('ml-before-page-2');
    const chatroomId = await createDuoTeamChatroom(sessionId);
    await joinParticipant(sessionId, chatroomId, 'builder');
    await sendMessages(sessionId, chatroomId, 45);

    const latest = await t.query(api.messageList.subscribeLatestMessages, {
      sessionId: sessionId as any,
      chatroomId,
      limit: 20,
    });
    const firstOlder = await t.query(api.messageList.listMessagesBefore, {
      sessionId: sessionId as any,
      chatroomId,
      before: latest[0]!._creationTime,
      limit: 20,
    });
    expect(firstOlder).toHaveLength(20);
    expect(firstOlder[0]!.content).toBe('message-6');

    const secondOlder = await t.query(api.messageList.listMessagesBefore, {
      sessionId: sessionId as any,
      chatroomId,
      before: firstOlder[0]!._creationTime,
      limit: 20,
    });
    expect(secondOlder).toHaveLength(5);
    expect(secondOlder[0]!.content).toBe('message-1');
    expect(secondOlder[4]!.content).toBe('message-5');
  });

  test('filters out join and progress types', async () => {
    const { sessionId } = await createTestSession('ml-before-filter-1');
    const chatroomId = await createDuoTeamChatroom(sessionId);
    await joinParticipant(sessionId, chatroomId, 'builder');

    await sendMessages(sessionId, chatroomId, 3);
    await sendMessageOfType(sessionId, chatroomId, 'join');
    await sendMessageOfType(sessionId, chatroomId, 'progress');

    const result = await t.query(api.messageList.listMessagesBefore, {
      sessionId: sessionId as any,
      chatroomId,
      before: Date.now() + 60_000,
      limit: 20,
    });

    expect(result).toHaveLength(3);
    for (const msg of result) {
      expect(msg.type).not.toBe('join');
      expect(msg.type).not.toBe('progress');
    }
  });

  test('rejects access from unauthenticated session', async () => {
    const { sessionId } = await createTestSession('ml-before-auth-1');
    const chatroomId = await createDuoTeamChatroom(sessionId);

    await expect(
      t.query(api.messageList.listMessagesBefore, {
        sessionId: 'invalid-session' as any,
        chatroomId,
        before: Date.now(),
        limit: 20,
      })
    ).rejects.toThrow();
  });
});
