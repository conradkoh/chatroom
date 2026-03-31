import { httpRouter } from 'convex/server';
import { httpAction } from './_generated/server';
import { internal } from './_generated/api';
import { parseTelegramUpdate } from './integrations/telegram';

const http = httpRouter();

// ─── Telegram Webhook ─────────────────────────────────────────────────────────

/**
 * POST /api/telegram/webhook/{integrationId}
 *
 * Receives Telegram update payloads and routes messages to the linked chatroom.
 * The integration ID in the URL determines which chatroom gets the message.
 */
http.route({
  pathPrefix: '/api/telegram/webhook/',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    try {
      // Extract integration ID from the URL path
      const url = new URL(request.url);
      const pathParts = url.pathname.split('/');
      const integrationId = pathParts[pathParts.length - 1];

      if (!integrationId) {
        return new Response(JSON.stringify({ error: 'Missing integration ID' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Look up the integration
      let integration;
      try {
        integration = await ctx.runQuery(internal.integrations.getInternal, {
          integrationId: integrationId as any, // Convex will validate the ID format
        });
      } catch {
        return new Response(JSON.stringify({ error: 'Invalid integration ID' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (!integration) {
        return new Response(JSON.stringify({ error: 'Integration not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (!integration.enabled) {
        // Return 200 to Telegram so it doesn't retry, but skip processing
        return new Response(JSON.stringify({ ok: true, skipped: 'disabled' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Verify Telegram webhook secret if one is configured
      const expectedSecret = integration.config?.webhookSecret;
      if (expectedSecret) {
        const receivedSecret = request.headers.get('x-telegram-bot-api-secret-token');
        if (receivedSecret !== expectedSecret) {
          console.warn(`[Telegram Webhook] Secret mismatch for integration=${integrationId}`);
          return new Response(JSON.stringify({ error: 'Invalid secret token' }), {
            status: 403,
            headers: { 'Content-Type': 'application/json' },
          });
        }
      }

      // Parse the Telegram update
      const body = await request.json();
      const parsed = parseTelegramUpdate(body);

      if (!parsed) {
        // Non-text update (photo, sticker, etc.) — acknowledge but skip
        return new Response(JSON.stringify({ ok: true, skipped: 'non-text' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      console.log(
        `[Telegram Webhook] Message received: integration=${integrationId} chat=${parsed.chatId} sender=${parsed.senderName}`
      );

      // Route the message to the chatroom
      await ctx.runMutation(internal.integrations.telegram.internal.handleIncomingMessage, {
        chatroomId: integration.chatroomId,
        integrationId: integration._id,
        telegramChatId: parsed.chatId,
        telegramMessageId: parsed.messageId,
        senderName: parsed.senderName,
        senderUsername: parsed.senderUsername,
        text: parsed.text,
        timestamp: parsed.date,
      });

      // Store the chat ID on the integration if not yet set
      if (!integration.config.chatId) {
        await ctx.runMutation(internal.integrations.updateChatId, {
          integrationId: integration._id,
          chatId: parsed.chatId,
        });
      }

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      console.error('Telegram webhook error:', error);
      // Always return 200 to Telegram to avoid infinite retries
      return new Response(JSON.stringify({ ok: true, error: 'internal' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }),
});

export default http;
