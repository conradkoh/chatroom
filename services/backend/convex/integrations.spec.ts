import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { t } from '../test.setup';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';

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
  chatroomId: Id<'chatroom_rooms'>,
  config: { botToken?: string; chatId?: string; webhookUrl?: string } = {}
): Promise<Id<'chatroom_integrations'>> {
  return await t.mutation(api.integrations.create, {
    sessionId,
    chatroomId,
    platform: 'telegram',
    config,
    enabled: true,
  });
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('integrations CRUD', () => {
  // ─── Create ─────────────────────────────────────────────────────────

  describe('create', () => {
    test('creates integration when user owns chatroom', async () => {
      const sessionId = await createTestSession('int-create-owner');
      const chatroomId = await createChatroom(sessionId);

      const integrationId = await createIntegration(sessionId, chatroomId, {
        botToken: 'test-bot-token-1234',
      });

      expect(integrationId).toBeTruthy();

      // Verify it was created
      const integration = await t.query(api.integrations.get, {
        sessionId,
        integrationId,
      });
      expect(integration).toBeTruthy();
      expect(integration.platform).toBe('telegram');
      expect(integration.enabled).toBe(true);
    });

    test('throws when user does not own chatroom', async () => {
      const ownerSession = await createTestSession('int-create-owner2');
      const attackerSession = await createTestSession('int-create-attacker');
      const chatroomId = await createChatroom(ownerSession);

      await expect(
        createIntegration(attackerSession, chatroomId, {
          botToken: 'stolen-token',
        })
      ).rejects.toThrow();
    });
  });

  // ─── Update ─────────────────────────────────────────────────────────

  describe('update', () => {
    test('updates integration when user owns chatroom', async () => {
      const sessionId = await createTestSession('int-update-owner');
      const chatroomId = await createChatroom(sessionId);
      const integrationId = await createIntegration(sessionId, chatroomId);

      const result = await t.mutation(api.integrations.update, {
        sessionId,
        integrationId,
        enabled: false,
      });

      expect(result.success).toBe(true);
    });

    test('throws when user does not own chatroom', async () => {
      const ownerSession = await createTestSession('int-update-owner2');
      const attackerSession = await createTestSession('int-update-attacker');
      const chatroomId = await createChatroom(ownerSession);
      const integrationId = await createIntegration(ownerSession, chatroomId);

      await expect(
        t.mutation(api.integrations.update, {
          sessionId: attackerSession,
          integrationId,
          enabled: false,
        })
      ).rejects.toThrow();
    });

    test('throws NOT_FOUND when integration does not exist', async () => {
      const sessionId = await createTestSession('int-update-notfound');

      await expect(
        t.mutation(api.integrations.update, {
          sessionId,
          integrationId: 'invalid_id_that_doesnt_exist' as Id<'chatroom_integrations'>,
          enabled: false,
        })
      ).rejects.toThrow();
    });
  });

  // ─── Remove ─────────────────────────────────────────────────────────

  describe('remove', () => {
    test('deletes integration when user owns chatroom', async () => {
      const sessionId = await createTestSession('int-remove-owner');
      const chatroomId = await createChatroom(sessionId);
      const integrationId = await createIntegration(sessionId, chatroomId);

      const result = await t.mutation(api.integrations.remove, {
        sessionId,
        integrationId,
      });

      expect(result.success).toBe(true);
    });

    test('throws when user does not own chatroom', async () => {
      const ownerSession = await createTestSession('int-remove-owner2');
      const attackerSession = await createTestSession('int-remove-attacker');
      const chatroomId = await createChatroom(ownerSession);
      const integrationId = await createIntegration(ownerSession, chatroomId);

      await expect(
        t.mutation(api.integrations.remove, {
          sessionId: attackerSession,
          integrationId,
        })
      ).rejects.toThrow();
    });

    test('throws NOT_FOUND when integration does not exist', async () => {
      const sessionId = await createTestSession('int-remove-notfound');

      await expect(
        t.mutation(api.integrations.remove, {
          sessionId,
          integrationId: 'invalid_id_that_doesnt_exist' as Id<'chatroom_integrations'>,
        })
      ).rejects.toThrow();
    });
  });

  // ─── List ───────────────────────────────────────────────────────────

  describe('list', () => {
    test('lists integrations for a chatroom', async () => {
      const sessionId = await createTestSession('int-list-owner');
      const chatroomId = await createChatroom(sessionId);

      await createIntegration(sessionId, chatroomId, { botToken: 'token-abc-1234' });
      await createIntegration(sessionId, chatroomId, { botToken: 'token-xyz-5678' });

      const integrations = await t.query(api.integrations.list, {
        sessionId,
        chatroomId,
      });

      expect(integrations).toHaveLength(2);
    });

    test('redacts bot tokens to show only last 4 chars', async () => {
      const sessionId = await createTestSession('int-list-redact');
      const chatroomId = await createChatroom(sessionId);

      await createIntegration(sessionId, chatroomId, { botToken: 'my-secret-bot-token-abcd' });

      const integrations = await t.query(api.integrations.list, {
        sessionId,
        chatroomId,
      });

      expect(integrations).toHaveLength(1);
      const botToken = integrations[0].config.botToken;
      expect(botToken).toBeTruthy();
      // Should end with last 4 chars of original
      expect(botToken!.endsWith('abcd')).toBe(true);
      // Should be redacted (dots + last 4)
      expect(botToken!.startsWith('•')).toBe(true);
    });

    test('does not expose webhook secrets', async () => {
      const sessionId = await createTestSession('int-list-nosecret');
      const chatroomId = await createChatroom(sessionId);

      await createIntegration(sessionId, chatroomId);

      const integrations = await t.query(api.integrations.list, {
        sessionId,
        chatroomId,
      });

      expect(integrations).toHaveLength(1);
      expect(integrations[0].config.webhookSecret).toBeUndefined();
    });
  });

  // ─── Get ────────────────────────────────────────────────────────────

  describe('get', () => {
    test('gets integration by ID with redacted token', async () => {
      const sessionId = await createTestSession('int-get-owner');
      const chatroomId = await createChatroom(sessionId);
      const integrationId = await createIntegration(sessionId, chatroomId, {
        botToken: 'secret-token-wxyz',
      });

      const integration = await t.query(api.integrations.get, {
        sessionId,
        integrationId,
      });

      expect(integration).toBeTruthy();
      expect(integration._id).toBe(integrationId);
      // Token should be redacted
      expect(integration.config.botToken!.endsWith('wxyz')).toBe(true);
      expect(integration.config.botToken!.startsWith('•')).toBe(true);
      // Webhook secret should be hidden
      expect(integration.config.webhookSecret).toBeUndefined();
    });

    test('throws NOT_FOUND when integration does not exist', async () => {
      const sessionId = await createTestSession('int-get-notfound');

      await expect(
        t.query(api.integrations.get, {
          sessionId,
          integrationId: 'invalid_id_that_doesnt_exist' as Id<'chatroom_integrations'>,
        })
      ).rejects.toThrow();
    });
  });
});
