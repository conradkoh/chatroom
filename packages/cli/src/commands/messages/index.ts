/**
 * Messages commands for listing and filtering chatroom messages
 */

import type { MessagesDeps } from './deps.js';
import { api, type Id } from '../../api.js';
import { getSessionId, getOtherSessionUrls } from '../../infrastructure/auth/storage.js';
import { getConvexClient, getConvexUrl } from '../../infrastructure/convex/client.js';

// ─── Re-exports for testing ────────────────────────────────────────────────

export type { MessagesDeps } from './deps.js';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface ListBySenderRoleOptions {
  role: string;
  senderRole: string;
  limit?: number;
  full?: boolean;
}

export interface ListSinceMessageOptions {
  role: string;
  sinceMessageId: string;
  limit?: number;
  full?: boolean;
}

// ─── Default Deps Factory ──────────────────────────────────────────────────

async function createDefaultDeps(): Promise<MessagesDeps> {
  const client = await getConvexClient();
  return {
    backend: {
      mutation: (endpoint, args) => client.mutation(endpoint, args),
      query: (endpoint, args) => client.query(endpoint, args),
    },
    session: {
      getSessionId,
      getConvexUrl,
      getOtherSessionUrls,
    },
  };
}

// ─── Commands ───────────────────────────────────────────────────────────────

/**
 * List messages filtered by sender role
 * Uses the composite index for efficient filtering
 */
export async function listBySenderRole(
  chatroomId: string,
  options: ListBySenderRoleOptions,
  deps?: MessagesDeps
): Promise<void> {
  const d = deps ?? (await createDefaultDeps());

  // Get session ID for authentication
  const sessionId = d.session.getSessionId();
  if (!sessionId) {
    console.error(`❌ Not authenticated. Please run: chatroom auth login`);
    process.exit(1);
  }

  // Validate chatroom ID format
  if (
    !chatroomId ||
    typeof chatroomId !== 'string' ||
    chatroomId.length < 20 ||
    chatroomId.length > 40
  ) {
    console.error(
      `❌ Invalid chatroom ID format: ID must be 20-40 characters (got ${chatroomId?.length || 0})`
    );
    process.exit(1);
  }

  try {
    const messages = await d.backend.query(api.messages.listBySenderRole, {
      sessionId,
      chatroomId: chatroomId as Id<'chatroom_rooms'>,
      senderRole: options.senderRole,
      limit: options.limit || 10,
    });

    if (messages.length === 0) {
      console.log(`\n📭 No messages found for sender role: ${options.senderRole}`);
      return;
    }

    console.log(`\n📨 Messages from ${options.senderRole} (${messages.length} found):`);
    console.log('─'.repeat(60));

    for (const message of messages) {
      const timestamp = new Date(message._creationTime).toLocaleString();
      const classificationBadge = message.classification
        ? ` [${message.classification.toUpperCase()}]`
        : '';
      const statusBadge = message.taskStatus ? ` (${message.taskStatus})` : '';

      console.log(`\n🔹 ID: ${message._id}`);
      console.log(`   Time: ${timestamp}`);
      console.log(`   Type: ${message.type}${classificationBadge}${statusBadge}`);
      if (message.targetRole) {
        console.log(`   Target: ${message.targetRole}`);
      }
      if (message.featureTitle) {
        console.log(`   Title: ${message.featureTitle}`);
      }

      // Show content (truncated unless --full)
      const content = message.content;
      if (options.full) {
        console.log(
          `   Content:\n${content
            .split('\n')
            .map((l: string) => `   ${l}`)
            .join('\n')}`
        );
      } else {
        const firstLine = content.split('\n')[0];
        const truncated = firstLine.length > 100 ? firstLine.substring(0, 100) + '...' : firstLine;
        console.log(`   Content: ${truncated}`);
      }
    }

    console.log('\n' + '─'.repeat(60));
    console.log(`💡 Use --full to see complete message content`);
    console.log(`💡 Use --since-message-id=<id> to get all messages since a specific message`);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`\n❌ Error fetching messages: ${errorMessage}`);
    process.exit(1);
    return;
  }
}

/**
 * List all messages since a given message ID (inclusive)
 * Returns messages in ascending order (oldest first)
 */
export async function listSinceMessage(
  chatroomId: string,
  options: ListSinceMessageOptions,
  deps?: MessagesDeps
): Promise<void> {
  const d = deps ?? (await createDefaultDeps());

  // Get session ID for authentication
  const sessionId = d.session.getSessionId();
  if (!sessionId) {
    console.error(`❌ Not authenticated. Please run: chatroom auth login`);
    process.exit(1);
  }

  // Validate chatroom ID format
  if (
    !chatroomId ||
    typeof chatroomId !== 'string' ||
    chatroomId.length < 20 ||
    chatroomId.length > 40
  ) {
    console.error(
      `❌ Invalid chatroom ID format: ID must be 20-40 characters (got ${chatroomId?.length || 0})`
    );
    process.exit(1);
  }

  try {
    const messages = await d.backend.query(api.messages.listSinceMessage, {
      sessionId,
      chatroomId: chatroomId as Id<'chatroom_rooms'>,
      sinceMessageId: options.sinceMessageId as Id<'chatroom_messages'>,
      limit: options.limit || 100,
    });

    if (messages.length === 0) {
      console.log(`\n📭 No messages found since message: ${options.sinceMessageId}`);
      return;
    }

    console.log(`\n📨 Messages since ${options.sinceMessageId} (${messages.length} found):`);
    console.log('─'.repeat(60));

    for (const message of messages) {
      const timestamp = new Date(message._creationTime).toLocaleString();
      const roleIndicator = message.senderRole.toLowerCase() === 'user' ? '👤' : '🤖';
      const classificationBadge = message.classification
        ? ` [${message.classification.toUpperCase()}]`
        : '';
      const statusBadge = message.taskStatus ? ` (${message.taskStatus})` : '';

      console.log(
        `\n${roleIndicator} ${message.senderRole}${message.targetRole ? ` → ${message.targetRole}` : ''}`
      );
      console.log(`   ID: ${message._id}`);
      console.log(`   Time: ${timestamp}`);
      console.log(`   Type: ${message.type}${classificationBadge}${statusBadge}`);
      if (message.featureTitle) {
        console.log(`   Title: ${message.featureTitle}`);
      }

      // Show content (truncated unless --full)
      const content = message.content;
      if (options.full) {
        console.log(
          `   Content:\n${content
            .split('\n')
            .map((l: string) => `   ${l}`)
            .join('\n')}`
        );
      } else {
        const firstLine = content.split('\n')[0];
        const truncated = firstLine.length > 100 ? firstLine.substring(0, 100) + '...' : firstLine;
        console.log(`   Content: ${truncated}`);
      }
    }

    console.log('\n' + '─'.repeat(60));
    console.log(`💡 Use --full to see complete message content`);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`\n❌ Error fetching messages: ${errorMessage}`);
    process.exit(1);
    return;
  }
}
