/**
 * Telegram CLI Commands — send messages to Telegram via chatroom integrations.
 *
 * Allows agents to push messages to connected Telegram chats.
 */

import { ConvexError } from 'convex/values';

import type { TelegramDeps } from './deps.js';
import { api } from '../../api.js';
import type { Id } from '../../api.js';
import { getSessionId, getOtherSessionUrls } from '../../infrastructure/auth/storage.js';
import { getConvexClient, getConvexUrl } from '../../infrastructure/convex/client.js';
import {
  formatError,
  formatAuthError,
  formatChatroomIdError,
} from '../../utils/error-formatting.js';

// ─── Re-exports for testing ────────────────────────────────────────────────

export type { TelegramDeps } from './deps.js';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface TelegramSendMessageOptions {
  chatroomId: string;
  integrationId: string;
  message: string;
  role?: string;
}

// ─── Default Deps Factory ──────────────────────────────────────────────────

async function createDefaultDeps(): Promise<TelegramDeps> {
  const client = await getConvexClient();
  return {
    backend: {
      action: (endpoint, args) => client.action(endpoint, args),
    },
    session: {
      getSessionId,
      getConvexUrl,
      getOtherSessionUrls,
    },
  };
}

// ─── Commands ──────────────────────────────────────────────────────────────

/**
 * Send a message to a connected Telegram integration for a chatroom.
 */
export async function sendMessage(
  options: TelegramSendMessageOptions,
  deps?: TelegramDeps
): Promise<void> {
  const d = deps ?? (await createDefaultDeps());

  // Get session ID for authentication
  const sessionId = d.session.getSessionId();
  if (!sessionId) {
    const otherUrls = d.session.getOtherSessionUrls();
    const currentUrl = d.session.getConvexUrl();
    formatAuthError(currentUrl, otherUrls);
    process.exit(1);
    return;
  }

  // Validate chatroom ID format
  const { chatroomId } = options;
  if (
    !chatroomId ||
    typeof chatroomId !== 'string' ||
    chatroomId.length < 20 ||
    chatroomId.length > 40
  ) {
    formatChatroomIdError(chatroomId);
    process.exit(1);
    return;
  }

  // Validate message is not empty
  if (!options.message || options.message.trim().length === 0) {
    formatError('Message cannot be empty', [
      'Provide a message via --message flag',
      'Example: chatroom telegram send-message --chatroom-id=<id> --integration-id=<id> --message="Hello"',
    ]);
    process.exit(1);
    return;
  }

  const senderRole = options.role || 'user';

  try {
    const result = await d.backend.action(api.integrations.telegram.actions.sendMessage, {
      sessionId,
      chatroomId: chatroomId as Id<'chatroom_rooms'>,
      message: options.message,
      senderRole,
    });

    if (result?.success) {
      console.log('✅ Message sent to Telegram');
      console.log(`📨 "${options.message}"`);
    }
  } catch (error) {
    console.error('\n❌ ERROR: Failed to send message to Telegram');

    if (error instanceof ConvexError) {
      const errorData = error.data as { code?: string; message?: string };
      console.error(`\n${errorData.message || 'An unexpected error occurred'}`);

      if (process.env.CHATROOM_DEBUG === 'true') {
        console.error('\n🔍 Debug Info:');
        console.error(JSON.stringify(errorData, null, 2));
      }
    } else {
      console.error(`\n${error instanceof Error ? error.message : String(error)}`);

      if (process.env.CHATROOM_DEBUG === 'true') {
        console.error('\n🔍 Debug Info:');
        console.error(error);
      }
    }

    console.error('\n📚 Need help? Run:');
    console.error('   chatroom telegram send-message --help');
    process.exit(1);
  }
}
