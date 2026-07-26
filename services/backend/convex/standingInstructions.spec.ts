/**
 * Tests for standing instructions — name field.
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

describe('standing instructions name', () => {
  test('get returns name as empty string when field absent', async () => {
    const { sessionId } = await createTestSession('si-name-absent');
    const chatroomId = await createChatroom(sessionId);

    const result = await t.query(api.standingInstructions.get, {
      sessionId,
      chatroomId,
    });

    expect(result.name).toBe('');
  });

  test('upsert with name stores trimmed name', async () => {
    const { sessionId } = await createTestSession('si-name-trim');
    const chatroomId = await createChatroom(sessionId);

    await t.mutation(api.standingInstructions.upsert, {
      sessionId,
      chatroomId,
      content: 'always be coding',
      name: '  My Rule  ',
    });

    const result = await t.query(api.standingInstructions.get, {
      sessionId,
      chatroomId,
    });

    expect(result.name).toBe('My Rule');
  });

  test('upsert with empty or whitespace name clears field', async () => {
    const { sessionId } = await createTestSession('si-name-clear');
    const chatroomId = await createChatroom(sessionId);

    // First set a name
    await t.mutation(api.standingInstructions.upsert, {
      sessionId,
      chatroomId,
      content: 'test',
      name: 'My Rule',
    });

    // Then clear it
    await t.mutation(api.standingInstructions.upsert, {
      sessionId,
      chatroomId,
      content: 'test',
      name: '',
    });

    const result = await t.query(api.standingInstructions.get, {
      sessionId,
      chatroomId,
    });

    expect(result.name).toBe('');
  });

  test('upsert with long name throws NAME_TOO_LONG', async () => {
    const { sessionId } = await createTestSession('si-name-long');
    const chatroomId = await createChatroom(sessionId);

    await expect(
      t.mutation(api.standingInstructions.upsert, {
        sessionId,
        chatroomId,
        content: 'test',
        name: 'x'.repeat(121),
      })
    ).rejects.toThrow(/NAME_TOO_LONG/i);
  });

  test('clear removes name along with content', async () => {
    const { sessionId } = await createTestSession('si-name-clear-all');
    const chatroomId = await createChatroom(sessionId);

    await t.mutation(api.standingInstructions.upsert, {
      sessionId,
      chatroomId,
      content: 'test content',
      name: 'My Rule',
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
    expect(result.name).toBe('');
    expect(result.enabled).toBe(false);
  });
});
