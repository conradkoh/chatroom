/**
 * web.conversationModePreferences — the narrowed mode validator.
 *
 * The retired enhanced mode must fail closed at the mutation boundary, even
 * when an old client sends it.
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { t } from '../../test.setup';
import { api } from '../_generated/api';
import type { Id } from '../_generated/dataModel';

async function createTestSession(id: string) {
  const login = await t.mutation(api.auth.loginAnon, { sessionId: id as SessionId });
  expect(login.success).toBe(true);
  return id as SessionId;
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

describe('web.conversationModePreferences.set', () => {
  test('persists chat and code, and rejects the retired enhanced mode', async () => {
    const sessionId = await createTestSession('conv-mode-prefs-validator');
    const chatroomId = await createChatroom(sessionId);

    await t.mutation(api.web.conversationModePreferences.set, {
      sessionId,
      chatroomId,
      mode: 'chat',
    });
    await expect(
      t.query(api.web.conversationModePreferences.get, { sessionId, chatroomId })
    ).resolves.toBe('chat');

    await t.mutation(api.web.conversationModePreferences.set, {
      sessionId,
      chatroomId,
      mode: 'code',
    });
    await expect(
      t.query(api.web.conversationModePreferences.get, { sessionId, chatroomId })
    ).resolves.toBe('code');

    await expect(
      t.mutation(api.web.conversationModePreferences.set, {
        sessionId,
        chatroomId,
        // The retired literal, built at runtime so this spec does not advertise it.
        mode: ['code', 'enhanced'].join(':') as 'code',
      })
    ).rejects.toThrow();
  });
});
