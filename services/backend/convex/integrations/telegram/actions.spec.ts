import { ConvexError } from 'convex/values';
import type { SessionId } from 'convex-helpers/server/sessions';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { t } from '../../../test.setup';
import { api } from '../../_generated/api';
import type { Id } from '../../_generated/dataModel';

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
    teamId: 'duo',
    teamName: 'Duo Team',
    teamRoles: ['planner', 'builder'],
    teamEntryPoint: 'planner',
  });
}

async function createIntegration(
  sessionId: SessionId,
  chatroomId: Id<'chatroom_rooms'>,
  overrides: {
    chatId?: string | undefined;
    botToken?: string | undefined;
    enabled?: boolean | undefined;
    platform?: string | undefined;
  } = {}
): Promise<Id<'chatroom_integrations'>> {
  return await t.mutation(api.integrations.create, {
    sessionId,
    chatroomId,
    platform: overrides.platform ?? 'telegram',
    config: {
      botToken: overrides.botToken ?? 'test-bot-token',
      chatId: overrides.chatId ?? '12345',
    },
    enabled: overrides.enabled ?? true,
  });
}

/** Assert the promise rejects with a ConvexError carrying the expected code. */
async function expectConvexErrorCode(
  promise: Promise<unknown>,
  code: string
): Promise<ConvexError<unknown>> {
  const error = await promise.then(
    () => null,
    (reason: unknown) => reason
  );
  expect(error).toBeInstanceOf(ConvexError);
  const convexError = error as ConvexError<{ code?: string; message?: string }>;
  expect(convexError.data).toMatchObject({ code });
  return convexError;
}

function bodyOf(call: unknown[]): { chat_id: string; text: string } {
  const init = call[1] as { body?: string };
  return JSON.parse(init.body ?? '{}') as { chat_id: string; text: string };
}

function urlOf(call: unknown[]): string {
  return String(call[0]);
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('telegram actions', () => {
  describe('sendMessage', () => {
    beforeEach(() => {
      vi.stubGlobal(
        'fetch',
        vi.fn(
          async () =>
            new Response(JSON.stringify({ ok: true, result: { message_id: 42 } }), { status: 200 })
        )
      );
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    test('targets only the given integration with exactly one HTTP call', async () => {
      const sessionId = await createTestSession('tg-send-target');
      const chatroomId = await createChatroom(sessionId);
      const integrationA = await createIntegration(sessionId, chatroomId, {
        botToken: 'tok-A',
        chatId: '111',
      });
      await createIntegration(sessionId, chatroomId, { botToken: 'tok-B', chatId: '222' });

      const result = await t.action(api.integrations.telegram.actions.sendMessage, {
        sessionId,
        chatroomId,
        integrationId: integrationA,
        message: 'hello',
        senderRole: 'coordinator',
      });

      const fetchMock = vi.mocked(fetch);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const call = fetchMock.mock.calls[0]!;
      expect(urlOf(call).endsWith('/bottok-A/sendMessage')).toBe(true);
      expect(bodyOf(call)).toEqual({ chat_id: '111', text: '[coordinator] hello' });
      expect(result).toEqual({
        success: true,
        integrationId: integrationA,
        telegramMessageId: 42,
      });
    });

    test('delivers any sender role, labelling only', async () => {
      const sessionId = await createTestSession('tg-send-roles');
      const chatroomId = await createChatroom(sessionId);
      const integrationId = await createIntegration(sessionId, chatroomId);

      await t.action(api.integrations.telegram.actions.sendMessage, {
        sessionId,
        chatroomId,
        integrationId,
        message: 'from triage',
        senderRole: 'triage',
      });
      await t.action(api.integrations.telegram.actions.sendMessage, {
        sessionId,
        chatroomId,
        integrationId,
        message: 'from the user',
        senderRole: 'user',
      });

      const fetchMock = vi.mocked(fetch);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(bodyOf(fetchMock.mock.calls[0]!).text).toBe('[triage] from triage');
      expect(bodyOf(fetchMock.mock.calls[1]!).text).toBe('[You] from the user');
    });

    test('rejects an integration owned by another chatroom with INTEGRATION_NOT_FOUND', async () => {
      const ownerSession = await createTestSession('tg-send-foreign-owner');
      const otherSession = await createTestSession('tg-send-foreign-other');
      const chatroom = await createChatroom(ownerSession);
      const otherChatroom = await createChatroom(otherSession);
      const foreignIntegration = await createIntegration(otherSession, otherChatroom);

      await expectConvexErrorCode(
        t.action(api.integrations.telegram.actions.sendMessage, {
          sessionId: ownerSession,
          chatroomId: chatroom,
          integrationId: foreignIntegration,
          message: 'hello',
          senderRole: 'builder',
        }),
        'INTEGRATION_NOT_FOUND'
      );
      expect(vi.mocked(fetch)).toHaveBeenCalledTimes(0);
    });

    test("rejects another user's chatroom with ACCESS_DENIED", async () => {
      const ownerSession = await createTestSession('tg-send-owner');
      const attackerSession = await createTestSession('tg-send-attacker');
      const chatroomId = await createChatroom(ownerSession);
      const integrationId = await createIntegration(ownerSession, chatroomId);

      await expectConvexErrorCode(
        t.action(api.integrations.telegram.actions.sendMessage, {
          sessionId: attackerSession,
          chatroomId,
          integrationId,
          message: 'hello',
          senderRole: 'builder',
        }),
        'ACCESS_DENIED'
      );
      expect(vi.mocked(fetch)).toHaveBeenCalledTimes(0);
    });

    test('rejects a never-logged-in session with AUTH_FAILED', async () => {
      const ownerSession = await createTestSession('tg-send-auth-owner');
      const chatroomId = await createChatroom(ownerSession);
      const integrationId = await createIntegration(ownerSession, chatroomId);

      await expectConvexErrorCode(
        t.action(api.integrations.telegram.actions.sendMessage, {
          sessionId: 'never-logged-in-session' as SessionId,
          chatroomId,
          integrationId,
          message: 'hello',
          senderRole: 'builder',
        }),
        'AUTH_FAILED'
      );
      expect(vi.mocked(fetch)).toHaveBeenCalledTimes(0);
    });

    test('rejects a non-Telegram integration with INTEGRATION_WRONG_PLATFORM', async () => {
      const sessionId = await createTestSession('tg-send-wrong-platform');
      const chatroomId = await createChatroom(sessionId);
      const integrationId = await createIntegration(sessionId, chatroomId, { platform: 'slack' });

      await expectConvexErrorCode(
        t.action(api.integrations.telegram.actions.sendMessage, {
          sessionId,
          chatroomId,
          integrationId,
          message: 'hello',
          senderRole: 'builder',
        }),
        'INTEGRATION_WRONG_PLATFORM'
      );
      expect(vi.mocked(fetch)).toHaveBeenCalledTimes(0);
    });

    test('rejects a disabled integration with INTEGRATION_DISABLED', async () => {
      const sessionId = await createTestSession('tg-send-disabled');
      const chatroomId = await createChatroom(sessionId);
      const integrationId = await createIntegration(sessionId, chatroomId, { enabled: false });

      await expectConvexErrorCode(
        t.action(api.integrations.telegram.actions.sendMessage, {
          sessionId,
          chatroomId,
          integrationId,
          message: 'hello',
          senderRole: 'builder',
        }),
        'INTEGRATION_DISABLED'
      );
      expect(vi.mocked(fetch)).toHaveBeenCalledTimes(0);
    });

    test('rejects an integration missing its chat ID with INTEGRATION_NOT_CONFIGURED', async () => {
      const sessionId = await createTestSession('tg-send-unconfigured');
      const chatroomId = await createChatroom(sessionId);
      const integrationId = await createIntegration(sessionId, chatroomId);

      // Remove the chat ID after creation so the stored config is incomplete.
      await t.mutation(api.integrations.update, {
        sessionId,
        integrationId,
        config: { botToken: 'test-bot-token' },
      });

      await expectConvexErrorCode(
        t.action(api.integrations.telegram.actions.sendMessage, {
          sessionId,
          chatroomId,
          integrationId,
          message: 'hello',
          senderRole: 'builder',
        }),
        'INTEGRATION_NOT_CONFIGURED'
      );
      expect(vi.mocked(fetch)).toHaveBeenCalledTimes(0);
    });

    test('reports TELEGRAM_SEND_FAILED when Telegram rejects without leaking the token', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(
          async () =>
            new Response(
              JSON.stringify({ ok: false, description: 'Bad Request: chat not found' }),
              {
                status: 400,
              }
            )
        )
      );

      const sessionId = await createTestSession('tg-send-rejected');
      const chatroomId = await createChatroom(sessionId);
      const integrationId = await createIntegration(sessionId, chatroomId, {
        botToken: 'super-secret-token',
      });

      const error = await expectConvexErrorCode(
        t.action(api.integrations.telegram.actions.sendMessage, {
          sessionId,
          chatroomId,
          integrationId,
          message: 'hello',
          senderRole: 'builder',
        }),
        'TELEGRAM_SEND_FAILED'
      );

      expect(error.data.message).toContain('chat not found');
      expect(error.data.message).not.toContain('super-secret-token');
      expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    });

    test('reports TELEGRAM_SEND_FAILED without leaking the URL or token when fetch rejects', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
          throw new Error('network down');
        })
      );

      const sessionId = await createTestSession('tg-send-network');
      const chatroomId = await createChatroom(sessionId);
      const integrationId = await createIntegration(sessionId, chatroomId, {
        botToken: 'super-secret-token',
      });

      const error = await expectConvexErrorCode(
        t.action(api.integrations.telegram.actions.sendMessage, {
          sessionId,
          chatroomId,
          integrationId,
          message: 'hello',
          senderRole: 'builder',
        }),
        'TELEGRAM_SEND_FAILED'
      );

      expect(error.data.message).not.toContain('super-secret-token');
      expect(error.data.message).not.toContain('api.telegram.org');
      expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    });

    test('rejects a whitespace-only message with INVALID_MESSAGE', async () => {
      const sessionId = await createTestSession('tg-send-empty');
      const chatroomId = await createChatroom(sessionId);
      const integrationId = await createIntegration(sessionId, chatroomId);

      await expectConvexErrorCode(
        t.action(api.integrations.telegram.actions.sendMessage, {
          sessionId,
          chatroomId,
          integrationId,
          message: '   ',
          senderRole: 'builder',
        }),
        'INVALID_MESSAGE'
      );
      expect(vi.mocked(fetch)).toHaveBeenCalledTimes(0);
    });
  });

  describe('validateBotToken', () => {
    const BOT_TOKEN = '123456:secret';

    beforeEach(() => {
      vi.stubGlobal(
        'fetch',
        vi.fn(
          async () =>
            new Response(
              JSON.stringify({
                ok: true,
                result: { id: 7, first_name: 'Bot', username: 'bot' },
              }),
              { status: 200 }
            )
        )
      );
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    test('rejects a never-logged-in session with AUTH_FAILED before calling Telegram', async () => {
      const ownerSession = await createTestSession('tg-validate-auth-owner');
      const chatroomId = await createChatroom(ownerSession);

      const error = await expectConvexErrorCode(
        t.action(api.integrations.telegram.actions.validateBotToken, {
          sessionId: 'tg-validate-auth' as SessionId,
          chatroomId,
          botToken: BOT_TOKEN,
        }),
        'AUTH_FAILED'
      );

      expect(vi.mocked(fetch)).toHaveBeenCalledTimes(0);
      expect(error.data.message).not.toContain(BOT_TOKEN);
    });

    test("rejects another user's chatroom with ACCESS_DENIED before calling Telegram", async () => {
      const ownerSession = await createTestSession('tg-validate-owner');
      const attackerSession = await createTestSession('tg-validate-attacker');
      const chatroomId = await createChatroom(ownerSession);

      const error = await expectConvexErrorCode(
        t.action(api.integrations.telegram.actions.validateBotToken, {
          sessionId: attackerSession,
          chatroomId,
          botToken: BOT_TOKEN,
        }),
        'ACCESS_DENIED'
      );

      expect(vi.mocked(fetch)).toHaveBeenCalledTimes(0);
      expect(error.data.message).not.toContain(BOT_TOKEN);
    });

    test('returns bot info for the chatroom owner with exactly one HTTP call', async () => {
      const sessionId = await createTestSession('tg-validate-owner-ok');
      const chatroomId = await createChatroom(sessionId);

      const result = await t.action(api.integrations.telegram.actions.validateBotToken, {
        sessionId,
        chatroomId,
        botToken: BOT_TOKEN,
      });

      expect(result).toEqual({ botId: 7, botName: 'Bot', botUsername: 'bot' });
      const fetchMock = vi.mocked(fetch);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(urlOf(fetchMock.mock.calls[0]!)).toBe(
        `https://api.telegram.org/bot${BOT_TOKEN}/getMe`
      );
    });
  });

  describe('registerWebhook', () => {
    const BOT_TOKEN = '123456:secret';
    const originalSiteUrl = process.env.CONVEX_SITE_URL;
    let webhookUrlPrefix: string;

    beforeEach(() => {
      process.env.CONVEX_SITE_URL = 'https://example.convex.site';
      webhookUrlPrefix = 'https://example.convex.site/api/telegram/webhook';
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }))
      );
    });

    afterEach(() => {
      vi.unstubAllGlobals();
      if (originalSiteUrl === undefined) {
        delete process.env.CONVEX_SITE_URL;
      } else {
        process.env.CONVEX_SITE_URL = originalSiteUrl;
      }
    });

    test('rejects a never-logged-in session with AUTH_FAILED before calling Telegram', async () => {
      const ownerSession = await createTestSession('tg-register-auth-owner');
      const chatroomId = await createChatroom(ownerSession);
      const integrationId = await createIntegration(ownerSession, chatroomId);

      const error = await expectConvexErrorCode(
        t.action(api.integrations.telegram.actions.registerWebhook, {
          sessionId: 'tg-register-auth' as SessionId,
          botToken: BOT_TOKEN,
          integrationId,
        }),
        'AUTH_FAILED'
      );

      expect(vi.mocked(fetch)).toHaveBeenCalledTimes(0);
      expect(error.data.message).not.toContain(BOT_TOKEN);
      const stored = await t.run((ctx) => ctx.db.get('chatroom_integrations', integrationId));
      expect(stored?.config.webhookUrl).toBeUndefined();
      expect(stored?.config.webhookSecret).toBeUndefined();
    });

    test("rejects another user's integration with INTEGRATION_NOT_FOUND before calling Telegram", async () => {
      const ownerSession = await createTestSession('tg-register-foreign-owner');
      const attackerSession = await createTestSession('tg-register-foreign-attacker');
      const ownerChatroom = await createChatroom(ownerSession);
      const integrationId = await createIntegration(ownerSession, ownerChatroom);

      const error = await expectConvexErrorCode(
        t.action(api.integrations.telegram.actions.registerWebhook, {
          sessionId: attackerSession,
          botToken: BOT_TOKEN,
          integrationId,
        }),
        'INTEGRATION_NOT_FOUND'
      );

      expect(vi.mocked(fetch)).toHaveBeenCalledTimes(0);
      expect(error.data.message).not.toContain(BOT_TOKEN);
      const stored = await t.run((ctx) => ctx.db.get('chatroom_integrations', integrationId));
      expect(stored?.config.webhookUrl).toBeUndefined();
      expect(stored?.config.webhookSecret).toBeUndefined();
    });

    test('gives the same response for a missing integration as for a foreign one', async () => {
      const ownerSession = await createTestSession('tg-register-oracle-owner');
      const attackerSession = await createTestSession('tg-register-oracle-attacker');
      const ownerChatroom = await createChatroom(ownerSession);
      const attackerChatroom = await createChatroom(attackerSession);
      const foreignIntegration = await createIntegration(attackerSession, attackerChatroom);

      const foreignError = await expectConvexErrorCode(
        t.action(api.integrations.telegram.actions.registerWebhook, {
          sessionId: ownerSession,
          botToken: BOT_TOKEN,
          integrationId: foreignIntegration,
        }),
        'INTEGRATION_NOT_FOUND'
      );

      // A deleted integration is indistinguishable from one owned by someone else.
      const deletedIntegration = await createIntegration(ownerSession, ownerChatroom);
      await t.run((ctx) => ctx.db.delete('chatroom_integrations', deletedIntegration));

      const missingError = await expectConvexErrorCode(
        t.action(api.integrations.telegram.actions.registerWebhook, {
          sessionId: ownerSession,
          botToken: BOT_TOKEN,
          integrationId: deletedIntegration,
        }),
        'INTEGRATION_NOT_FOUND'
      );

      expect(missingError.data).toEqual(foreignError.data);
      expect(vi.mocked(fetch)).toHaveBeenCalledTimes(0);
    });

    test('stores the webhook URL and a secret for the owner', async () => {
      const sessionId = await createTestSession('tg-register-owner');
      const chatroomId = await createChatroom(sessionId);
      const integrationId = await createIntegration(sessionId, chatroomId);

      const result = await t.action(api.integrations.telegram.actions.registerWebhook, {
        sessionId,
        botToken: BOT_TOKEN,
        integrationId,
      });

      const expectedUrl = `${webhookUrlPrefix}/${integrationId}`;
      expect(result).toEqual({ webhookUrl: expectedUrl });
      expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);

      const stored = await t.run((ctx) => ctx.db.get('chatroom_integrations', integrationId));
      expect(stored?.config.webhookUrl).toBe(expectedUrl);
      expect(stored?.config.webhookSecret).toBeTruthy();
    });
  });

  describe('removeWebhook', () => {
    const BOT_TOKEN = '123456:secret';
    const originalSiteUrl = process.env.CONVEX_SITE_URL;

    beforeEach(() => {
      process.env.CONVEX_SITE_URL = 'https://example.convex.site';
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }))
      );
    });

    afterEach(() => {
      vi.unstubAllGlobals();
      if (originalSiteUrl === undefined) {
        delete process.env.CONVEX_SITE_URL;
      } else {
        process.env.CONVEX_SITE_URL = originalSiteUrl;
      }
    });

    /** Register a webhook as the owner so the removal tests have something to protect. */
    async function seedWebhook(
      sessionId: SessionId,
      integrationId: Id<'chatroom_integrations'>
    ): Promise<void> {
      await t.action(api.integrations.telegram.actions.registerWebhook, {
        sessionId,
        botToken: BOT_TOKEN,
        integrationId,
      });
    }

    test('rejects a never-logged-in session with AUTH_FAILED and leaves the webhook intact', async () => {
      const ownerSession = await createTestSession('tg-remove-auth-owner');
      const chatroomId = await createChatroom(ownerSession);
      const integrationId = await createIntegration(ownerSession, chatroomId);
      await seedWebhook(ownerSession, integrationId);
      const before = await t.run((ctx) => ctx.db.get('chatroom_integrations', integrationId));

      const error = await expectConvexErrorCode(
        t.action(api.integrations.telegram.actions.removeWebhook, {
          sessionId: 'tg-remove-auth' as SessionId,
          botToken: BOT_TOKEN,
          integrationId,
        }),
        'AUTH_FAILED'
      );

      // Only the seeding registration reached Telegram.
      expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
      expect(error.data.message).not.toContain(BOT_TOKEN);
      const after = await t.run((ctx) => ctx.db.get('chatroom_integrations', integrationId));
      expect(after?.config).toEqual(before?.config);
      expect(after?.config.webhookUrl).toBeTruthy();
      expect(after?.config.webhookSecret).toBeTruthy();
    });

    test("rejects another user's integration with INTEGRATION_NOT_FOUND and leaves the webhook intact", async () => {
      const ownerSession = await createTestSession('tg-remove-foreign-owner');
      const attackerSession = await createTestSession('tg-remove-foreign-attacker');
      const ownerChatroom = await createChatroom(ownerSession);
      const integrationId = await createIntegration(ownerSession, ownerChatroom);
      await seedWebhook(ownerSession, integrationId);
      const before = await t.run((ctx) => ctx.db.get('chatroom_integrations', integrationId));

      const error = await expectConvexErrorCode(
        t.action(api.integrations.telegram.actions.removeWebhook, {
          sessionId: attackerSession,
          botToken: BOT_TOKEN,
          integrationId,
        }),
        'INTEGRATION_NOT_FOUND'
      );

      expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
      expect(error.data.message).not.toContain(BOT_TOKEN);
      expect(error.data.message).not.toContain(before?.config.webhookSecret ?? '');
      const after = await t.run((ctx) => ctx.db.get('chatroom_integrations', integrationId));
      expect(after?.config).toEqual(before?.config);
    });

    test('gives the same response for a missing integration as for a foreign one', async () => {
      const ownerSession = await createTestSession('tg-remove-oracle-owner');
      const attackerSession = await createTestSession('tg-remove-oracle-attacker');
      const ownerChatroom = await createChatroom(ownerSession);
      const attackerChatroom = await createChatroom(attackerSession);
      const foreignIntegration = await createIntegration(attackerSession, attackerChatroom);

      const foreignError = await expectConvexErrorCode(
        t.action(api.integrations.telegram.actions.removeWebhook, {
          sessionId: ownerSession,
          botToken: BOT_TOKEN,
          integrationId: foreignIntegration,
        }),
        'INTEGRATION_NOT_FOUND'
      );

      const deletedIntegration = await createIntegration(ownerSession, ownerChatroom);
      await t.run((ctx) => ctx.db.delete('chatroom_integrations', deletedIntegration));

      const missingError = await expectConvexErrorCode(
        t.action(api.integrations.telegram.actions.removeWebhook, {
          sessionId: ownerSession,
          botToken: BOT_TOKEN,
          integrationId: deletedIntegration,
        }),
        'INTEGRATION_NOT_FOUND'
      );

      expect(missingError.data).toEqual(foreignError.data);
      expect(vi.mocked(fetch)).toHaveBeenCalledTimes(0);
    });

    test('clears the webhook URL and secret for the owner', async () => {
      const sessionId = await createTestSession('tg-remove-owner');
      const chatroomId = await createChatroom(sessionId);
      const integrationId = await createIntegration(sessionId, chatroomId);
      await seedWebhook(sessionId, integrationId);

      const result = await t.action(api.integrations.telegram.actions.removeWebhook, {
        sessionId,
        botToken: BOT_TOKEN,
        integrationId,
      });

      expect(result).toEqual({ success: true });
      expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
      const stored = await t.run((ctx) => ctx.db.get('chatroom_integrations', integrationId));
      expect(stored?.config.webhookUrl).toBeUndefined();
      expect(stored?.config.webhookSecret).toBeFalsy();
    });
  });
});
