/**
 * Telegram Bot Internal — Convex mutations/queries for Telegram integration.
 *
 * These run in the Convex runtime (NOT Node.js) and handle DB operations.
 * Actions that call external APIs are in api.ts.
 */

import { v, ConvexError } from 'convex/values';

import type { Id } from '../../_generated/dataModel';
import { internalMutation, internalQuery } from '../../_generated/server';
import { requireChatroomAccess } from '../../auth/chatroomAccess';
import { omitUndefined } from '../../lib/omitUndefined';

// ─── Internal Queries ─────────────────────────────────────────────────────────

/** A resolved Telegram integration the caller is allowed to send to. */
export interface TelegramSendTarget {
  integrationId: Id<'chatroom_integrations'>;
  botToken: string;
  chatId: string;
}

/**
 * Resolve the single integration a caller may send to.
 * Caller: telegram/actions.ts `sendMessage`. The access check runs FIRST so a
 * denied caller learns nothing about the integration.
 */
export const resolveSendTarget = internalQuery({
  args: {
    sessionId: v.string(),
    chatroomId: v.id('chatroom_rooms'),
    integrationId: v.id('chatroom_integrations'),
  },
  // fallow-ignore-next-line complexity
  handler: async (ctx, args): Promise<TelegramSendTarget> => {
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId); // AUTH_FAILED | ACCESS_DENIED

    const integration = await ctx.db.get('chatroom_integrations', args.integrationId);
    if (!integration || integration.chatroomId !== args.chatroomId) {
      // Missing and foreign integrations are indistinguishable: no existence oracle.
      throw new ConvexError({
        code: 'INTEGRATION_NOT_FOUND',
        message:
          'Integration not found in this chatroom. Run `chatroom integrations list --chatroom-id=<id>` to see available integrations.',
      });
    }

    if (integration.platform !== 'telegram') {
      throw new ConvexError({
        code: 'INTEGRATION_WRONG_PLATFORM',
        message: `Integration is a ${integration.platform} integration, not Telegram.`,
      });
    }

    if (!integration.enabled) {
      throw new ConvexError({
        code: 'INTEGRATION_DISABLED',
        message: 'Integration is disabled. Enable it in the chatroom settings first.',
      });
    }

    const { botToken, chatId } = integration.config;
    if (!botToken || !chatId) {
      throw new ConvexError({
        code: 'INTEGRATION_NOT_CONFIGURED',
        message: 'Integration is missing its bot token or chat ID.',
      });
    }

    return { integrationId: integration._id, botToken, chatId };
  },
});

// ─── Internal Mutations ───────────────────────────────────────────────────────

/**
 * Update the webhook URL and secret on an integration record.
 * Called internally by registerWebhook action.
 */
export const updateWebhookRegistration = internalMutation({
  args: {
    integrationId: v.id('chatroom_integrations'),
    webhookUrl: v.string(),
    webhookSecret: v.string(),
  },
  handler: async (ctx, args) => {
    const integration = await ctx.db.get('chatroom_integrations', args.integrationId);
    if (!integration) return;

    await ctx.db.patch('chatroom_integrations', args.integrationId, {
      config: omitUndefined({
        ...integration.config,
        webhookUrl: args.webhookUrl || undefined,
        webhookSecret: args.webhookSecret,
      }),
      updatedAt: Date.now(),
    });
  },
});
