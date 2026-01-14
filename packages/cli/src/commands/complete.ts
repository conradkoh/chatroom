/**
 * Complete a chatroom
 */

import { api, type Id } from '../api.js';
import { getConvexClient } from '../infrastructure/convex/client.js';

export async function completeChatroom(chatroomId: string): Promise<void> {
  const client = await getConvexClient();

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
    await client.mutation(api.chatrooms.updateStatus, {
      chatroomId: chatroomId as Id<'chatrooms'>,
      status: 'completed',
    });

    console.log(`✅ Chatroom ${chatroomId} marked as completed`);
  } catch (error) {
    console.error(`❌ Failed to complete chatroom: ${(error as Error).message}`);
    process.exit(1);
  }
}
