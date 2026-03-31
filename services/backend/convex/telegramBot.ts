'use node';

/**
 * Telegram Bot Actions — Convex actions that call the Telegram Bot API.
 *
 * These run in Node.js and use `fetch` to communicate with Telegram.
 * Mutations/queries are in telegramBotInternal.ts (Convex runtime).
 */

import { v, ConvexError } from 'convex/values';
import { internalAction } from './_generated/server';
import { internal } from './_generated/api';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Subset of Telegram's User object returned by getMe. */
interface TelegramBotInfo {
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string;
}

/** Telegram getMe API response. */
interface GetMeResponse {
  ok: boolean;
  result?: TelegramBotInfo;
  description?: string;
}

/** Telegram setWebhook / deleteWebhook API response. */
interface WebhookResponse {
  ok: boolean;
  result?: boolean;
  description?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const TELEGRAM_API = 'https://api.telegram.org';

// ─── Actions ──────────────────────────────────────────────────────────────────

/**
 * Validate a Telegram bot token by calling getMe.
 * Returns bot info on success, throws on failure.
 */
export const validateBotToken = internalAction({
  args: {
    botToken: v.string(),
  },
  handler: async (_ctx, args) => {
    const url = `${TELEGRAM_API}/bot${args.botToken}/getMe`;

    const response = await fetch(url);
    const data = (await response.json()) as GetMeResponse;

    if (!data.ok || !data.result) {
      throw new ConvexError({
        code: 'INVALID_BOT_TOKEN',
        message: data.description ?? 'Invalid bot token — Telegram API rejected it',
      });
    }

    return {
      botId: data.result.id,
      botName: data.result.first_name,
      botUsername: data.result.username ?? null,
    };
  },
});

/**
 * Register a Telegram webhook pointing to our Convex HTTP endpoint.
 */
export const registerWebhook = internalAction({
  args: {
    botToken: v.string(),
    integrationId: v.id('chatroom_integrations'),
  },
  handler: async (ctx, args) => {
    // Derive the Convex site URL server-side (never trust client input)
    const convexSiteUrl = process.env.CONVEX_SITE_URL;
    if (!convexSiteUrl) {
      throw new ConvexError({
        code: 'CONFIGURATION_ERROR',
        message: 'CONVEX_SITE_URL environment variable is not set',
      });
    }

    const webhookUrl = `${convexSiteUrl}/api/telegram/webhook/${args.integrationId}`;

    // Generate a random webhook secret for verification
    const webhookSecret = Array.from({ length: 32 }, () =>
      Math.random().toString(36).charAt(2)
    ).join('');

    const url = `${TELEGRAM_API}/bot${args.botToken}/setWebhook`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: webhookUrl,
        allowed_updates: ['message'],
        secret_token: webhookSecret,
      }),
    });

    const data = (await response.json()) as WebhookResponse;

    if (!data.ok) {
      throw new ConvexError({
        code: 'WEBHOOK_REGISTRATION_FAILED',
        message: data.description ?? 'Failed to register Telegram webhook',
      });
    }

    // Update integration with webhook URL and secret
    await ctx.runMutation(internal.telegramBotInternal.updateWebhookRegistration, {
      integrationId: args.integrationId,
      webhookUrl,
      webhookSecret,
    });

    return { webhookUrl };
  },
});

/**
 * Remove the Telegram webhook when disconnecting an integration.
 */
export const removeWebhook = internalAction({
  args: {
    botToken: v.string(),
    integrationId: v.id('chatroom_integrations'),
  },
  handler: async (ctx, args) => {
    const url = `${TELEGRAM_API}/bot${args.botToken}/deleteWebhook`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ drop_pending_updates: false }),
    });

    const data = (await response.json()) as WebhookResponse;

    if (!data.ok) {
      throw new ConvexError({
        code: 'WEBHOOK_REMOVAL_FAILED',
        message: data.description ?? 'Failed to remove Telegram webhook',
      });
    }

    // Clear webhook URL and secret from integration
    await ctx.runMutation(internal.telegramBotInternal.updateWebhookRegistration, {
      integrationId: args.integrationId,
      webhookUrl: '',
      webhookSecret: '',
    });

    return { success: true };
  },
});

// ─── Outbound Forwarding ──────────────────────────────────────────────────────

/**
 * Forward a chatroom message to all active Telegram integrations for that chatroom.
 * Skips messages that originated from Telegram (loop prevention via sourcePlatform).
 */
export const forwardToTelegram = internalAction({
  args: {
    chatroomId: v.id('chatroom_rooms'),
    content: v.string(),
    senderRole: v.string(),
    sourcePlatform: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Loop prevention: don't forward messages that came from Telegram
    if (args.sourcePlatform === 'telegram') return;

    // Skip non-user/agent messages (system messages, etc.)
    if (args.senderRole !== 'user' && !args.senderRole.match(/^(planner|builder|reviewer)$/)) {
      return;
    }

    // Get active Telegram integrations for this chatroom
    const integrations = await ctx.runQuery(internal.integrations.listActiveByPlatform, {
      chatroomId: args.chatroomId,
      platform: 'telegram',
    });

    if (!integrations || integrations.length === 0) return;

    // Forward to each active Telegram integration
    for (const integration of integrations) {
      const chatId = integration.config.chatId;
      const botToken = integration.config.botToken;

      if (!chatId || !botToken) continue;

      try {
        const label = args.senderRole === 'user' ? 'You' : args.senderRole;
        const text = `[${label}] ${args.content}`;

        const url = `${TELEGRAM_API}/bot${botToken}/sendMessage`;
        await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text,
          }),
        });
      } catch (error) {
        console.error(`Failed to forward to Telegram integration ${integration._id}:`, error);
      }
    }
  },
});
