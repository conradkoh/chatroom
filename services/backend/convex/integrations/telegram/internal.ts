/**
 * Telegram Bot Internal — Convex mutations/queries for Telegram integration.
 *
 * These run in the Convex runtime (NOT Node.js) and handle DB operations.
 * Actions that call external APIs are in api.ts.
 */

import { v } from 'convex/values';
import { internalMutation } from '../../_generated/server';
import type { TelegramUpdate } from './types';

// ─── Internal Mutations ───────────────────────────────────────────────────────

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

    // Sanitize text — strip any markdown/HTML that could render unexpectedly
    const sanitizedText = args.text
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    const content = `[Telegram · ${senderLabel}] ${sanitizedText}`;

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
    const integration = await ctx.db.get(args.integrationId);
    if (!integration) return;

    await ctx.db.patch(args.integrationId, {
      config: {
        ...integration.config,
        webhookUrl: args.webhookUrl || undefined,
        webhookSecret: args.webhookSecret,
      },
      updatedAt: Date.now(),
    });
  },
});
