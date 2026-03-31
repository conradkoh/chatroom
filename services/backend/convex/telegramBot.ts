'use node';

/**
 * Telegram Bot Actions — Convex actions that call the Telegram Bot API.
 *
 * These run in Node.js and use `fetch` to communicate with Telegram.
 * Mutations/queries are in telegramBotInternal.ts (Convex runtime).
 */

import { v, ConvexError } from 'convex/values';
import { action } from './_generated/server';
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
export const validateBotToken = action({
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
export const registerWebhook = action({
  args: {
    botToken: v.string(),
    integrationId: v.id('chatroom_integrations'),
    convexSiteUrl: v.string(),
  },
  handler: async (ctx, args) => {
    const webhookUrl = `${args.convexSiteUrl}/api/telegram/webhook/${args.integrationId}`;

    const url = `${TELEGRAM_API}/bot${args.botToken}/setWebhook`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: webhookUrl,
        allowed_updates: ['message'],
      }),
    });

    const data = (await response.json()) as WebhookResponse;

    if (!data.ok) {
      throw new ConvexError({
        code: 'WEBHOOK_REGISTRATION_FAILED',
        message: data.description ?? 'Failed to register Telegram webhook',
      });
    }

    // Update integration with webhook URL
    await ctx.runMutation(internal.telegramBotInternal.updateWebhookUrl, {
      integrationId: args.integrationId,
      webhookUrl,
    });

    return { webhookUrl };
  },
});

/**
 * Remove the Telegram webhook when disconnecting an integration.
 */
export const removeWebhook = action({
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

    // Clear webhook URL from integration
    await ctx.runMutation(internal.telegramBotInternal.updateWebhookUrl, {
      integrationId: args.integrationId,
      webhookUrl: '',
    });

    return { success: true };
  },
});

/**
 * Send a message to a Telegram chat via the Bot API.
 */
export const sendMessage = action({
  args: {
    botToken: v.string(),
    chatId: v.string(),
    text: v.string(),
  },
  handler: async (_ctx, args) => {
    const url = `${TELEGRAM_API}/bot${args.botToken}/sendMessage`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: args.chatId,
        text: args.text,
        parse_mode: 'Markdown',
      }),
    });

    const data = (await response.json()) as { ok: boolean; description?: string };

    if (!data.ok) {
      throw new ConvexError({
        code: 'SEND_MESSAGE_FAILED',
        message: data.description ?? 'Failed to send Telegram message',
      });
    }

    return { success: true };
  },
});

// ─── Outbound Forwarding ──────────────────────────────────────────────────────

/**
 * Forward a chatroom message to all active Telegram integrations for that chatroom.
 * Skips messages that originated from Telegram (loop prevention via sourcePlatform).
 */
export const forwardToTelegram = action({
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
