'use node';

/**
 * Telegram Bot Utilities — Convex actions for interacting with the Telegram Bot API.
 *
 * These are used by the integration setup flow to:
 * 1. Validate a bot token (getMe)
 * 2. Register/remove a webhook (setWebhook / deleteWebhook)
 * 3. Process incoming Telegram updates
 */

import { v, ConvexError } from 'convex/values';
import { action, internalMutation } from './_generated/server';
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

/** Subset of a Telegram Update object (message updates only). */
interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from?: {
      id: number;
      is_bot: boolean;
      first_name: string;
      last_name?: string;
      username?: string;
    };
    chat: {
      id: number;
      type: string;
      title?: string;
      first_name?: string;
      last_name?: string;
      username?: string;
    };
    date: number;
    text?: string;
  };
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
    convexSiteUrl: v.string(), // e.g. "https://example-123.convex.site"
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
    await ctx.runMutation(internal.telegramBot.updateWebhookUrl, {
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
    await ctx.runMutation(internal.telegramBot.updateWebhookUrl, {
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

// ─── Internal Mutations ───────────────────────────────────────────────────────

/**
 * Update the webhook URL on an integration record.
 * Called internally by registerWebhook / removeWebhook actions.
 */
export const updateWebhookUrl = internalMutation({
  args: {
    integrationId: v.id('chatroom_integrations'),
    webhookUrl: v.string(),
  },
  handler: async (ctx, args) => {
    const integration = await ctx.db.get(args.integrationId);
    if (!integration) return;

    await ctx.db.patch(args.integrationId, {
      config: {
        ...integration.config,
        webhookUrl: args.webhookUrl || undefined,
      },
      updatedAt: Date.now(),
    });
  },
});

/**
 * Process an incoming Telegram message — create a chatroom message.
 * Called by the HTTP webhook handler.
 */
export const handleIncomingMessage = internalMutation({
  args: {
    chatroomId: v.id('chatroom_rooms'),
    integrationId: v.id('chatroom_integrations'),
    telegramChatId: v.string(),
    telegramMessageId: v.number(),
    senderName: v.string(),
    senderUsername: v.optional(v.string()),
    text: v.string(),
    timestamp: v.number(),
  },
  handler: async (ctx, args) => {
    // Create a message in the chatroom from the Telegram user
    const senderLabel = args.senderUsername
      ? `${args.senderName} (@${args.senderUsername})`
      : args.senderName;

    const content = `[Telegram · ${senderLabel}] ${args.text}`;

    await ctx.db.insert('chatroom_messages', {
      chatroomId: args.chatroomId,
      senderRole: 'user',
      content,
      targetRole: undefined,
      type: 'message',
      sourcePlatform: 'telegram',
    });

    // Update chatroom activity
    await ctx.db.patch(args.chatroomId, {
      lastActivityAt: Date.now(),
    });

    return { success: true };
  },
});

/**
 * Parse and route a raw Telegram update payload.
 * Returns the extracted data or null if the update should be skipped.
 */
export function parseTelegramUpdate(update: TelegramUpdate) {
  const message = update.message;
  if (!message || !message.text) return null;

  return {
    messageId: message.message_id,
    chatId: String(message.chat.id),
    chatType: message.chat.type,
    chatTitle: message.chat.title ?? message.chat.first_name ?? 'Unknown',
    senderName: [message.from?.first_name, message.from?.last_name].filter(Boolean).join(' ') || 'Unknown',
    senderUsername: message.from?.username,
    senderId: message.from?.id ? String(message.from.id) : undefined,
    text: message.text,
    date: message.date,
  };
}

// ─── Outbound Forwarding ──────────────────────────────────────────────────────

/**
 * Forward a chatroom message to all active Telegram integrations for that chatroom.
 * Skips messages that originated from Telegram (loop prevention via sourcePlatform).
 *
 * Called from the messages module after a message is inserted.
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
        // Format the outbound message with sender context
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
        // Log but don't fail — the primary message was already saved
        console.error(`Failed to forward to Telegram integration ${integration._id}:`, error);
      }
    }
  },
});
