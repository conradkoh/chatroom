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

describe('updateHistory and deleteHistory', () => {
  test('updateHistory trims title and content and persists', async () => {
    const { sessionId } = await createTestSession('si-update-history');
    const chatroomId = await createChatroom(sessionId);

    await t.mutation(api.standingInstructions.upsert, {
      sessionId,
      chatroomId,
      content: 'Always use TypeScript',
      title: 'Type safety',
    });

    const history = await t.query(api.standingInstructions.listHistory, { sessionId });

    await t.mutation(api.standingInstructions.updateHistory, {
      sessionId,
      historyId: history[0]!._id,
      content: '  updated content  ',
      title: '  Updated Title  ',
    });

    const updated = await t.query(api.standingInstructions.listHistory, { sessionId });
    expect(updated[0]!.content).toBe('updated content');
    expect(updated[0]!.title).toBe('Updated Title');
  });

  test('updateHistory throws TITLE_REQUIRED on empty title', async () => {
    const { sessionId } = await createTestSession('si-update-title-required');
    const chatroomId = await createChatroom(sessionId);

    await t.mutation(api.standingInstructions.upsert, {
      sessionId,
      chatroomId,
      content: 'Rule one',
      title: 'Rule one',
    });

    const history = await t.query(api.standingInstructions.listHistory, { sessionId });

    await expect(
      t.mutation(api.standingInstructions.updateHistory, {
        sessionId,
        historyId: history[0]!._id,
        content: 'Rule one',
        title: '',
      })
    ).rejects.toThrow(/TITLE_REQUIRED/i);
  });

  test('updateHistory throws CONTENT_EMPTY on empty content', async () => {
    const { sessionId } = await createTestSession('si-update-content-empty');
    const chatroomId = await createChatroom(sessionId);

    await t.mutation(api.standingInstructions.upsert, {
      sessionId,
      chatroomId,
      content: 'Rule one',
      title: 'Rule one',
    });

    const history = await t.query(api.standingInstructions.listHistory, { sessionId });

    await expect(
      t.mutation(api.standingInstructions.updateHistory, {
        sessionId,
        historyId: history[0]!._id,
        content: '   ',
        title: 'Rule one',
      })
    ).rejects.toThrow(/CONTENT_EMPTY/i);
  });

  test('updateHistory throws CONFLICT when contentKey matches another row', async () => {
    const { sessionId } = await createTestSession('si-update-conflict');
    const chatroomId = await createChatroom(sessionId);

    await t.mutation(api.standingInstructions.upsert, {
      sessionId,
      chatroomId,
      content: 'First rule',
      title: 'First',
    });
    await t.mutation(api.standingInstructions.upsert, {
      sessionId,
      chatroomId,
      content: 'Second rule',
      title: 'Second',
    });

    const history = await t.query(api.standingInstructions.listHistory, { sessionId });
    const second = history.find((row) => row.content === 'Second rule');

    await expect(
      t.mutation(api.standingInstructions.updateHistory, {
        sessionId,
        historyId: second!._id,
        content: 'First rule',
        title: 'First copy',
      })
    ).rejects.toThrow(/CONFLICT/i);
  });

  test('deleteHistory removes row and listHistory reflects deletion', async () => {
    const { sessionId } = await createTestSession('si-delete-history');
    const chatroomId = await createChatroom(sessionId);

    await t.mutation(api.standingInstructions.upsert, {
      sessionId,
      chatroomId,
      content: 'Delete me',
      title: 'Delete me',
    });

    const history = await t.query(api.standingInstructions.listHistory, { sessionId });
    expect(history).toHaveLength(1);

    await t.mutation(api.standingInstructions.deleteHistory, {
      sessionId,
      historyId: history[0]!._id,
    });

    const after = await t.query(api.standingInstructions.listHistory, { sessionId });
    expect(after).toHaveLength(0);
  });

  test('deleteHistory throws NOT_FOUND for wrong user', async () => {
    const owner = await createTestSession('si-delete-owner');
    const other = await createTestSession('si-delete-other');
    const chatroomId = await createChatroom(owner.sessionId);

    await t.mutation(api.standingInstructions.upsert, {
      sessionId: owner.sessionId,
      chatroomId,
      content: 'Owner rule',
      title: 'Owner rule',
    });

    const history = await t.query(api.standingInstructions.listHistory, {
      sessionId: owner.sessionId,
    });

    await expect(
      t.mutation(api.standingInstructions.deleteHistory, {
        sessionId: other.sessionId,
        historyId: history[0]!._id,
      })
    ).rejects.toThrow(/NOT_FOUND/i);
  });
});
