/**
 * Telegram Bot Internal — Convex mutations/queries for Telegram integration.
 *
 * These run in the Convex runtime (NOT Node.js) and handle DB operations.
 * Actions that call external APIs are in telegramBot.ts.
 */

import { v } from 'convex/values';
import { internalMutation } from './_generated/server';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Subset of a Telegram Update object (message updates only). */
export interface TelegramUpdate {
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

// ─── Pure Utilities ───────────────────────────────────────────────────────────

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
