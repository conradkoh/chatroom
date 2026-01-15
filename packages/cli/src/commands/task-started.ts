/**
 * Acknowledge a task has started and classify the user message
 */

import { api } from '../api.js';
import type { Id, Message } from '../api.js';
import { getSessionId } from '../infrastructure/auth/storage.js';
import { getConvexClient } from '../infrastructure/convex/client.js';

interface TaskStartedOptions {
  role: string;
  classification: 'question' | 'new_feature' | 'follow_up';
}

export async function taskStarted(chatroomId: string, options: TaskStartedOptions): Promise<void> {
  const client = await getConvexClient();
  const { role, classification } = options;

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

  // Get the most recent user message to classify
  const messages = (await client.query(api.messages.list, {
    sessionId,
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
    limit: 50,
  })) as Message[];

  // Find the most recent unclassified user message
  let targetMessage: Message | null = null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.senderRole.toLowerCase() === 'user' && msg.type === 'message' && !msg.classification) {
      targetMessage = msg;
      break;
    }
  }

  if (!targetMessage) {
    console.error(`❌ No unclassified user message found to acknowledge`);
    console.error(`   All user messages may already be classified.`);
    process.exit(1);
  }

  // Call the taskStarted mutation
  try {
    await client.mutation(api.messages.taskStarted, {
      sessionId,
      chatroomId: chatroomId as Id<'chatroom_rooms'>,
      role,
      messageId: targetMessage._id,
      classification,
    });

    console.log(`✅ Task acknowledged and classified`);
    console.log(`   Classification: ${classification}`);
    console.log(
      `   Message: "${targetMessage.content.substring(0, 80)}${targetMessage.content.length > 80 ? '...' : ''}"`
    );

    // Show classification-specific guidance
    switch (classification) {
      case 'question':
        console.log(`\n💡 This is a question - you can respond directly to the user.`);
        break;
      case 'new_feature':
        console.log(
          `\n💡 This is a new feature request - changes must be reviewed before returning to user.`
        );
        break;
      case 'follow_up':
        console.log(
          `\n💡 This is a follow-up to a previous message - same rules as the original apply.`
        );
        break;
    }
  } catch (error) {
    const err = error as Error;
    console.error(`❌ Failed to acknowledge task: ${err.message}`);
    process.exit(1);
  }
}
