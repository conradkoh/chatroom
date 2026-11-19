import { ConvexError } from 'convex/values';
import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { t } from '../test.setup';
import { api, internal } from './_generated/api';
import type { Id } from './_generated/dataModel';

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Assert a promise rejects with a ConvexError carrying the expected `code`. */
async function expectConvexErrorCode(promise: Promise<unknown>, code: string): Promise<void> {
  const error = await promise.then(
    () => null,
    (reason: unknown) => reason
  );
  expect(error).toBeInstanceOf(ConvexError);
  expect((error as ConvexError).data).toMatchObject({ code });
}

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
  config: {
    botToken?: string | undefined;
    chatId?: string | undefined;
    webhookUrl?: string | undefined;
  } = {},
  extra: { name?: string; description?: string } = {}
): Promise<Id<'chatroom_integrations'>> {
  return await t.mutation(api.integrations.create, {
    sessionId,
    chatroomId,
    platform: 'telegram',
    config,
    enabled: true,
    ...extra,
  });
}

/** Read the stored document directly, bypassing redaction. */
async function getRawIntegration(id: Id<'chatroom_integrations'>) {
  return await t.run(async (ctx) => ctx.db.get('chatroom_integrations', id));
}

/** Count stored integration rows for a chatroom, bypassing redaction. */
async function countIntegrations(chatroomId: Id<'chatroom_rooms'>): Promise<number> {
  return await t
    .run(async (ctx) =>
      ctx.db
        .query('chatroom_integrations')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
        .collect()
    )
    .then((rows) => rows.length);
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

    test('stores trimmed name and description', async () => {
      const sessionId = await createTestSession('int-create-details');
      const chatroomId = await createChatroom(sessionId);

      const integrationId = await createIntegration(
        sessionId,
        chatroomId,
        {},
        { name: '  Ops alerts  ', description: '  Pager for production  ' }
      );

      const raw = await getRawIntegration(integrationId);
      expect(raw?.name).toBe('Ops alerts');
      expect(raw?.description).toBe('Pager for production');
    });

    test('omits name and description keys when blank', async () => {
      const sessionId = await createTestSession('int-create-blank-details');
      const chatroomId = await createChatroom(sessionId);

      const integrationId = await createIntegration(
        sessionId,
        chatroomId,
        {},
        { name: '   ', description: '' }
      );

      const raw = await getRawIntegration(integrationId);
      expect(raw).not.toBeNull();
      expect('name' in raw!).toBe(false);
      expect('description' in raw!).toBe(false);
    });

    test('rejects an over-limit name without inserting anything', async () => {
      const sessionId = await createTestSession('int-create-long-name');
      const chatroomId = await createChatroom(sessionId);

      const creation = createIntegration(sessionId, chatroomId, {}, { name: 'a'.repeat(81) });

      await expectConvexErrorCode(creation, 'VALIDATION_ERROR');
      const error = await creation.then(
        () => null,
        (reason: unknown) => reason
      );
      expect((error as ConvexError).data).toMatchObject({
        code: 'VALIDATION_ERROR',
        field: 'name',
        maxLength: 80,
      });
      expect(await countIntegrations(chatroomId)).toBe(0);
    });

    test('rejects an over-limit description', async () => {
      const sessionId = await createTestSession('int-create-long-description');
      const chatroomId = await createChatroom(sessionId);

      const creation = createIntegration(
        sessionId,
        chatroomId,
        {},
        { description: 'a'.repeat(501) }
      );

      await expectConvexErrorCode(creation, 'VALIDATION_ERROR');
      const error = await creation.then(
        () => null,
        (reason: unknown) => reason
      );
      expect((error as ConvexError).data).toMatchObject({
        code: 'VALIDATION_ERROR',
        field: 'description',
        maxLength: 500,
      });
      expect(await countIntegrations(chatroomId)).toBe(0);
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

    test('sets and clears the name without touching other fields', async () => {
      const sessionId = await createTestSession('int-update-name');
      const chatroomId = await createChatroom(sessionId);
      const integrationId = await createIntegration(sessionId, chatroomId, {
        botToken: 'tok-1234',
      });

      await t.mutation(api.integrations.update, {
        sessionId,
        integrationId,
        name: '  New name  ',
      });

      let raw = await getRawIntegration(integrationId);
      expect(raw?.name).toBe('New name');
      expect(raw?.config.botToken).toBe('tok-1234');

      await t.mutation(api.integrations.update, {
        sessionId,
        integrationId,
        name: '',
      });

      raw = await getRawIntegration(integrationId);
      expect('name' in raw!).toBe(false);
      expect(raw?.config.botToken).toBe('tok-1234');
    });

    test('rejects an over-limit name and writes nothing', async () => {
      const sessionId = await createTestSession('int-update-long-name');
      const chatroomId = await createChatroom(sessionId);
      const integrationId = await createIntegration(sessionId, chatroomId, {
        botToken: 'tok-1234',
      });
      await t.mutation(api.integrations.update, {
        sessionId,
        integrationId,
        name: 'Original',
      });
      const before = await getRawIntegration(integrationId);

      const update = t.mutation(api.integrations.update, {
        sessionId,
        integrationId,
        name: 'a'.repeat(81),
        enabled: false,
      });

      await expectConvexErrorCode(update, 'VALIDATION_ERROR');
      const error = await update.then(
        () => null,
        (reason: unknown) => reason
      );
      expect((error as ConvexError).data).toMatchObject({
        code: 'VALIDATION_ERROR',
        field: 'name',
        maxLength: 80,
      });
      expect(await getRawIntegration(integrationId)).toEqual(before);
    });

    test('rejects an over-limit description without writing a valid name from the same call', async () => {
      const sessionId = await createTestSession('int-update-partial');
      const chatroomId = await createChatroom(sessionId);
      const integrationId = await createIntegration(sessionId, chatroomId);
      const before = await getRawIntegration(integrationId);

      const update = t.mutation(api.integrations.update, {
        sessionId,
        integrationId,
        name: 'Should not persist',
        description: 'a'.repeat(501),
      });

      await expectConvexErrorCode(update, 'VALIDATION_ERROR');
      const error = await update.then(
        () => null,
        (reason: unknown) => reason
      );
      expect((error as ConvexError).data).toMatchObject({
        code: 'VALIDATION_ERROR',
        field: 'description',
        maxLength: 500,
      });
      expect(await getRawIntegration(integrationId)).toEqual(before);
    });

    test('leaves omitted detail fields unchanged', async () => {
      const sessionId = await createTestSession('int-update-omitted');
      const chatroomId = await createChatroom(sessionId);
      const integrationId = await createIntegration(sessionId, chatroomId, {}, { name: 'Keep me' });

      await t.mutation(api.integrations.update, {
        sessionId,
        integrationId,
        description: 'Desc',
      });

      const raw = await getRawIntegration(integrationId);
      expect(raw?.name).toBe('Keep me');
      expect(raw?.description).toBe('Desc');
    });

    test('preserves config (including webhook secret) and enabled across detail edits', async () => {
      const sessionId = await createTestSession('int-update-preserve');
      const chatroomId = await createChatroom(sessionId);
      const integrationId = await createIntegration(sessionId, chatroomId, {
        botToken: 'tok-1234',
        chatId: '123',
      });

      await t.mutation(internal.integrations.telegram.internal.updateWebhookRegistration, {
        integrationId,
        webhookUrl: 'https://x/hook',
        webhookSecret: 'sec',
      });

      const before = await getRawIntegration(integrationId);
      expect(before?.config.webhookSecret).toBe('sec');

      await t.mutation(api.integrations.update, {
        sessionId,
        integrationId,
        name: 'New',
      });
      await t.mutation(api.integrations.update, {
        sessionId,
        integrationId,
        description: 'Desc',
      });

      const after = await getRawIntegration(integrationId);
      expect(after?.config).toEqual(before?.config);
      expect(after?.config.webhookSecret).toBe('sec');
      expect(after?.enabled).toBe(before?.enabled);
      expect(after?.name).toBe('New');
      expect(after?.description).toBe('Desc');
    });

    test('toggling enabled leaves name and description unchanged', async () => {
      const sessionId = await createTestSession('int-update-enabled-details');
      const chatroomId = await createChatroom(sessionId);
      const integrationId = await createIntegration(
        sessionId,
        chatroomId,
        {},
        { name: 'Name', description: 'Description' }
      );

      await t.mutation(api.integrations.update, {
        sessionId,
        integrationId,
        enabled: false,
      });

      const raw = await getRawIntegration(integrationId);
      expect(raw?.enabled).toBe(false);
      expect(raw?.name).toBe('Name');
      expect(raw?.description).toBe('Description');
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

    test('returns name and description, and undefined for rows created without them', async () => {
      const sessionId = await createTestSession('int-list-details');
      const chatroomId = await createChatroom(sessionId);

      await createIntegration(sessionId, chatroomId, {}, { name: 'Ops', description: 'Pager' });
      await createIntegration(sessionId, chatroomId);

      const integrations = await t.query(api.integrations.list, {
        sessionId,
        chatroomId,
      });

      expect(integrations).toHaveLength(2);
      const withDetails = integrations.find((i) => i.name !== undefined);
      const withoutDetails = integrations.find((i) => i.name === undefined);
      expect(withDetails?.name).toBe('Ops');
      expect(withDetails?.description).toBe('Pager');
      expect(withoutDetails).toBeTruthy();
      expect(withoutDetails?.description).toBeUndefined();
    });

    test("rejects another user's chatroom with ACCESS_DENIED and returns no data", async () => {
      const ownerSession = await createTestSession('int-list-owner-access');
      const attackerSession = await createTestSession('int-list-attacker');
      const chatroomId = await createChatroom(ownerSession);
      await createIntegration(ownerSession, chatroomId);

      await expectConvexErrorCode(
        t.query(api.integrations.list, { sessionId: attackerSession, chatroomId }),
        'ACCESS_DENIED'
      );
    });

    test('rejects a never-logged-in session with AUTH_FAILED', async () => {
      const ownerSession = await createTestSession('int-list-owner-auth');
      const chatroomId = await createChatroom(ownerSession);

      await expectConvexErrorCode(
        t.query(api.integrations.list, {
          sessionId: 'never-logged-in-session' as SessionId,
          chatroomId,
        }),
        'AUTH_FAILED'
      );
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

    test('returns name and description with secrets still redacted', async () => {
      const sessionId = await createTestSession('int-get-details');
      const chatroomId = await createChatroom(sessionId);
      const integrationId = await createIntegration(
        sessionId,
        chatroomId,
        { botToken: 'secret-token-wxyz' },
        { name: 'Ops', description: 'Pager' }
      );
      await t.mutation(internal.integrations.telegram.internal.updateWebhookRegistration, {
        integrationId,
        webhookUrl: 'https://x/hook',
        webhookSecret: 'sec',
      });

      const integration = await t.query(api.integrations.get, {
        sessionId,
        integrationId,
      });

      expect(integration.name).toBe('Ops');
      expect(integration.description).toBe('Pager');
      expect(integration.config.botToken!.endsWith('wxyz')).toBe(true);
      expect(integration.config.webhookSecret).toBeUndefined();
    });

    test('returns undefined name and description for a row created without them', async () => {
      const sessionId = await createTestSession('int-get-no-details');
      const chatroomId = await createChatroom(sessionId);
      const integrationId = await createIntegration(sessionId, chatroomId);

      const integration = await t.query(api.integrations.get, {
        sessionId,
        integrationId,
      });

      expect(integration.name).toBeUndefined();
      expect(integration.description).toBeUndefined();
    });

    test('throws NOT_FOUND for a deleted integration', async () => {
      const sessionId = await createTestSession('int-get-deleted');
      const chatroomId = await createChatroom(sessionId);
      const integrationId = await createIntegration(sessionId, chatroomId);

      await t.mutation(api.integrations.remove, { sessionId, integrationId });

      await expectConvexErrorCode(
        t.query(api.integrations.get, { sessionId, integrationId }),
        'NOT_FOUND'
      );
    });

    test("rejects another user's integration with ACCESS_DENIED and returns no data", async () => {
      const ownerSession = await createTestSession('int-get-owner-access');
      const attackerSession = await createTestSession('int-get-attacker');
      const chatroomId = await createChatroom(ownerSession);
      const integrationId = await createIntegration(ownerSession, chatroomId);

      await expectConvexErrorCode(
        t.query(api.integrations.get, { sessionId: attackerSession, integrationId }),
        'ACCESS_DENIED'
      );
    });

    test('rejects a never-logged-in session with AUTH_FAILED', async () => {
      const ownerSession = await createTestSession('int-get-owner-auth');
      const chatroomId = await createChatroom(ownerSession);
      const integrationId = await createIntegration(ownerSession, chatroomId);

      await expectConvexErrorCode(
        t.query(api.integrations.get, {
          sessionId: 'never-logged-in-session' as SessionId,
          integrationId,
        }),
        'AUTH_FAILED'
      );
    });
  });
});
