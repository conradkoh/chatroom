import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { api } from '../../_generated/api';
import type { Id } from '../../_generated/dataModel';
import { t } from '../../../test.setup';

// ─── Helpers ────────────────────────────────────────────────────────────────

async function createTestSession(id: string): Promise<SessionId> {
  const login = await t.mutation(api.auth.loginAnon, {
    sessionId: id as SessionId,
  });
  expect(login.success).toBe(true);
  return id as SessionId;
}

async function createChatroom(sessionId: SessionId): Promise<Id<'chatroom_rooms'>> {
  return await t.mutation(api.chatrooms.create, {
    sessionId,
    teamId: 'pair',
    teamName: 'Pair Team',
    teamRoles: ['builder', 'reviewer'],
    teamEntryPoint: 'builder',
  });
}

async function createIntegration(
  sessionId: SessionId,
  chatroomId: Id<'chatroom_rooms'>
): Promise<Id<'chatroom_integrations'>> {
  return await t.mutation(api.integrations.create, {
    sessionId,
    chatroomId,
    platform: 'telegram',
    config: {
      botToken: 'test-bot-token',
      chatId: '12345',
    },
    enabled: true,
  });
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('telegram actions', () => {
  describe('sendMessage', () => {
    test('requires valid chatroom ID', async () => {
      const sessionId = await createTestSession('tg-send-invalid-cr');

      // Using an invalid chatroom ID should throw
      await expect(
        t.action(api.integrations.telegram.actions.sendMessage, {
          sessionId,
          chatroomId: 'invalid_chatroom_id' as Id<'chatroom_rooms'>,
          message: 'Hello from test',
          senderRole: 'builder',
        })
      ).rejects.toThrow();
    });

    test('accepts valid parameters without throwing for auth', async () => {
      const sessionId = await createTestSession('tg-send-valid');
      const chatroomId = await createChatroom(sessionId);
      await createIntegration(sessionId, chatroomId);

      // The actual Telegram API call will fail in test environment,
      // but the auth and parameter validation should pass.
      // forwardToTelegram will attempt to fetch Telegram's API which
      // will fail, but that's expected in a test environment.
      // We verify the function doesn't throw auth errors.
      try {
        await t.action(api.integrations.telegram.actions.sendMessage, {
          sessionId,
          chatroomId,
          message: 'Test message',
          senderRole: 'builder',
        });
      } catch (error) {
        // If it fails, it should be a network/fetch error, not auth
        const errorMsg = String(error);
        expect(errorMsg).not.toContain('AUTH_FAILED');
        expect(errorMsg).not.toContain('UNAUTHORIZED');
      }
    });
  });
});
