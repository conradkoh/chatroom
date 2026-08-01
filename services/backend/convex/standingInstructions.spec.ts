/**
 * Tests for standing instructions — title field.
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

describe('standing instructions title', () => {
  test('get returns title as empty string when field absent', async () => {
    const { sessionId } = await createTestSession('si-title-absent');
    const chatroomId = await createChatroom(sessionId);

    const result = await t.query(api.standingInstructions.get, {
      sessionId,
      chatroomId,
    });

    expect(result.title).toBe('');
  });

  test('upsert with title stores trimmed title', async () => {
    const { sessionId } = await createTestSession('si-title-trim');
    const chatroomId = await createChatroom(sessionId);

    await t.mutation(api.standingInstructions.upsert, {
      sessionId,
      chatroomId,
      content: 'always be coding',
      title: '  My Rule  ',
    });

    const result = await t.query(api.standingInstructions.get, {
      sessionId,
      chatroomId,
    });

    expect(result.title).toBe('My Rule');
  });

  test('upsert without title throws TITLE_REQUIRED', async () => {
    const { sessionId } = await createTestSession('si-title-required');
    const chatroomId = await createChatroom(sessionId);

    await expect(
      t.mutation(api.standingInstructions.upsert, {
        sessionId,
        chatroomId,
        content: 'some rule',
        title: '',
      })
    ).rejects.toThrow(/TITLE_REQUIRED/i);
  });

  test('upsert with long title throws TITLE_TOO_LONG', async () => {
    const { sessionId } = await createTestSession('si-title-long');
    const chatroomId = await createChatroom(sessionId);

    await expect(
      t.mutation(api.standingInstructions.upsert, {
        sessionId,
        chatroomId,
        content: 'test',
        title: 'x'.repeat(121),
      })
    ).rejects.toThrow(/TITLE_TOO_LONG/i);
  });

  test('clear removes title along with content', async () => {
    const { sessionId } = await createTestSession('si-title-clear-all');
    const chatroomId = await createChatroom(sessionId);

    await t.mutation(api.standingInstructions.upsert, {
      sessionId,
      chatroomId,
      content: 'test content',
      title: 'My Rule',
    });

    await t.mutation(api.standingInstructions.clear, {
      sessionId,
      chatroomId,
    });

    const result = await t.query(api.standingInstructions.get, {
      sessionId,
      chatroomId,
    });

    expect(result.content).toBe('');
    expect(result.title).toBe('');
    expect(result.enabled).toBe(false);
  });

  test('listHistory returns title', async () => {
    const { sessionId } = await createTestSession('si-title-history');
    const chatroomId = await createChatroom(sessionId);

    await t.mutation(api.standingInstructions.upsert, {
      sessionId,
      chatroomId,
      content: 'Always use TypeScript',
      title: 'Type safety',
    });

    const history = await t.query(api.standingInstructions.listHistory, {
      sessionId,
    });

    expect(history).toHaveLength(1);
    expect(history[0]!.content).toBe('Always use TypeScript');
    expect(history[0]!.title).toBe('Type safety');
  });

  test('recordUse returns title', async () => {
    const { sessionId } = await createTestSession('si-title-record-use');
    const chatroomId = await createChatroom(sessionId);

    await t.mutation(api.standingInstructions.upsert, {
      sessionId,
      chatroomId,
      content: 'Write unit tests first',
      title: 'Tests first',
    });

    const history = await t.query(api.standingInstructions.listHistory, {
      sessionId,
    });

    const result = await t.mutation(api.standingInstructions.recordUse, {
      sessionId,
      historyId: history[0]!._id,
    });

    expect(result.content).toBe('Write unit tests first');
    expect(result.title).toBe('Tests first');
  });
});
