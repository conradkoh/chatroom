'use node';

/**
 * Telegram Integration Actions — authenticated public actions for the frontend.
 *
 * These wrap the internal Telegram bot actions with session authentication.
 * Chatroom access is enforced (via `telegram/internal.ts`) before any Telegram
 * HTTP call or DB write.
 */

import { v, ConvexError } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { formatTelegramText, postTelegramMessage } from './api';
import { internal } from '../../_generated/api';
import type { Id } from '../../_generated/dataModel';
import { action } from '../../_generated/server';

/**
 * Validate a Telegram bot token (authenticated).
 */
export const validateBotToken = action({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    botToken: v.string(),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ botId: number; botName: string; botUsername: string | null }> => {
    await ctx.runQuery(internal.integrations.telegram.internal.requireTelegramSetupAccess, {
      sessionId: args.sessionId,
      chatroomId: args.chatroomId,
    });

    return await ctx.runAction(internal.integrations.telegram.api.validateBotToken, {
      botToken: args.botToken,
    });
  },
});

/**
 * Register a Telegram webhook (authenticated).
 */
export const registerWebhook = action({
  args: {
    ...SessionIdArg,
    botToken: v.string(),
    integrationId: v.id('chatroom_integrations'),
  },
  handler: async (ctx, args): Promise<{ webhookUrl: string }> => {
    await ctx.runQuery(internal.integrations.telegram.internal.requireWebhookIntegrationAccess, {
      sessionId: args.sessionId,
      integrationId: args.integrationId,
    });

    return await ctx.runAction(internal.integrations.telegram.api.registerWebhook, {
      botToken: args.botToken,
      integrationId: args.integrationId,
    });
  },
});

/**
 * Remove a Telegram webhook (authenticated).
 */
export const removeWebhook = action({
  args: {
    ...SessionIdArg,
    botToken: v.string(),
    integrationId: v.id('chatroom_integrations'),
  },
  handler: async (ctx, args): Promise<{ success: boolean }> => {
    await ctx.runQuery(internal.integrations.telegram.internal.requireWebhookIntegrationAccess, {
      sessionId: args.sessionId,
      integrationId: args.integrationId,
    });

    return await ctx.runAction(internal.integrations.telegram.api.removeWebhook, {
      botToken: args.botToken,
      integrationId: args.integrationId,
    });
  },
});

/** Result of an explicit send to exactly one Telegram integration. */
export interface SendTelegramMessageResult {
  success: true;
  integrationId: Id<'chatroom_integrations'>;
  telegramMessageId: number;
}

/**
 * Send one message to exactly one Telegram integration (authenticated).
 *
 * No role filtering: `senderRole` is only the `[label]`. Returns only after
 * Telegram accepts the message; every failure throws.
 */
export const sendMessage = action({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    integrationId: v.id('chatroom_integrations'),
    message: v.string(),
    senderRole: v.string(),
  },
  handler: async (ctx, args): Promise<SendTelegramMessageResult> => {
    if (args.message.trim().length === 0) {
      throw new ConvexError({ code: 'INVALID_MESSAGE', message: 'Message cannot be empty' });
    }

    const target = await ctx.runQuery(internal.integrations.telegram.internal.resolveSendTarget, {
      sessionId: args.sessionId,
      chatroomId: args.chatroomId,
      integrationId: args.integrationId,
    });

    const result = await postTelegramMessage({
      botToken: target.botToken,
      chatId: target.chatId,
      text: formatTelegramText(args.senderRole, args.message),
    });

    if (!result.ok) {
      throw new ConvexError({
        code: 'TELEGRAM_SEND_FAILED',
        integrationId: target.integrationId,
        message: `Telegram did not accept the message: ${result.reason}`,
      });
    }

    return {
      success: true,
      integrationId: target.integrationId,
      telegramMessageId: result.messageId,
    };
  },
});
