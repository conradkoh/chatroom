/**
 * Send a message to a chatroom
 */

import { api, type Id } from '../api.js';
import { getSessionId } from '../infrastructure/auth/storage.js';
import { getConvexClient } from '../infrastructure/convex/client.js';

interface SendOptions {
  message: string;
  role?: string;
  skipReadyCheck?: boolean;
}

export async function sendMessage(chatroomId: string, options: SendOptions): Promise<void> {
  const client = await getConvexClient();
  const role = options.role || 'user';

  // Get session ID for authentication
  const sessionId = getSessionId();
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

  // Check team readiness (unless skipped)
  if (!options.skipReadyCheck && role.toLowerCase() === 'user') {
    const readiness = await client.query(api.chatrooms.getTeamReadiness, {
      sessionId,
      chatroomId: chatroomId as Id<'chatrooms'>,
    });

    if (readiness && !readiness.isReady) {
      console.log(`✅ Team ready: ${readiness.teamName} (${readiness.expectedRoles.join(', ')})`);
    } else if (readiness && readiness.missingRoles.length > 0) {
      console.error(`⚠️  Team not ready. Missing: ${readiness.missingRoles.join(', ')}`);
      console.error('   Use --skip-ready-check to send anyway');
      process.exit(1);
    }
  }

  try {
    const messageId = await client.mutation(api.messages.send, {
      sessionId,
      chatroomId: chatroomId as Id<'chatrooms'>,
      senderRole: role,
      content: options.message,
      type: 'message',
    });

    console.log(`✅ Message sent!`);
    console.log(`📋 Message ID: ${messageId}`);
  } catch (error) {
    console.error(`❌ Failed to send message: ${(error as Error).message}`);
    process.exit(1);
  }
}
