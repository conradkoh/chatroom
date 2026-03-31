'use node';

/**
 * Telegram Integration Actions — authenticated public actions for the frontend.
 *
 * These wrap the internal Telegram bot actions with session authentication.
 */

import { v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';
import { action } from '../../_generated/server';
import { internal } from '../../_generated/api';

/**
 * Validate a Telegram bot token (authenticated).
 */
export const validateBotToken = action({
  args: {
    ...SessionIdArg,
    botToken: v.string(),
  },
  handler: async (ctx, args): Promise<{ botId: number; botName: string; botUsername: string | null }> => {
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
    return await ctx.runAction(internal.integrations.telegram.api.removeWebhook, {
      botToken: args.botToken,
      integrationId: args.integrationId,
    });
  },
});
