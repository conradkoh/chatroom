/**
 * Acknowledge a task has started and classify the user message
 */

import { api } from '../api.js';
import type { Id, Message } from '../api.js';
import { getSessionId, getOtherSessionUrls } from '../infrastructure/auth/storage.js';
import { getConvexClient, getConvexUrl } from '../infrastructure/convex/client.js';

interface TaskStartedOptions {
  role: string;
  classification: 'question' | 'new_feature' | 'follow_up';
  messageId: string;
  // Feature metadata (required for new_feature classification)
  title?: string;
  description?: string;
  techSpecs?: string;
}

export async function taskStarted(chatroomId: string, options: TaskStartedOptions): Promise<void> {
  const client = await getConvexClient();
  const { role, classification, title, description, techSpecs, messageId } = options;

  // Get session ID for authentication
  const sessionId = getSessionId();
  if (!sessionId) {
    const otherUrls = getOtherSessionUrls();
    const currentUrl = getConvexUrl();

    console.error(`❌ Not authenticated for: ${currentUrl}`);

    if (otherUrls.length > 0) {
      console.error(`\n💡 You have sessions for other environments:`);
      for (const url of otherUrls) {
        console.error(`   • ${url}`);
      }
      console.error(`\n   To use a different environment, set CHATROOM_CONVEX_URL:`);
      console.error(`   CHATROOM_CONVEX_URL=${otherUrls[0]} chatroom task-started ...`);
      console.error(`\n   Or to authenticate for the current environment:`);
    }

    console.error(`   chatroom auth login`);
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

  // Validate feature metadata for new_feature classification
  if (classification === 'new_feature') {
    const missingFields: string[] = [];
    if (!title || title.trim().length === 0) {
      missingFields.push('--title');
    }
    if (!description || description.trim().length === 0) {
      missingFields.push('--description');
    }
    if (!techSpecs || techSpecs.trim().length === 0) {
      missingFields.push('--tech-specs');
    }

    if (missingFields.length > 0) {
      console.error(`❌ new_feature classification requires feature metadata`);
      console.error(`   Missing fields: ${missingFields.join(', ')}`);
      console.error('');
      console.error('   Example:');
      console.error(
        `   chatroom task-started ${chatroomId} --role=${role} --classification=new_feature \\`
      );
      console.error(`     --title="Feature title" \\`);
      console.error(`     --description="What this feature does" \\`);
      console.error(`     --tech-specs="How to implement it"`);
      process.exit(1);
    }
  }

  // Find the target message to classify
  let targetMessage: Message | null = null;

  if (!messageId) {
    console.error(`❌ --message-id is required for task-started`);
    console.error(
      `   Usage: chatroom task-started <chatroomId> --role=<role> --classification=<type> --message-id=<messageId>`
    );
    process.exit(1);
  }

  // Use explicit message ID
  const messages = (await client.query(api.messages.list, {
    sessionId,
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
    limit: 1000, // Get more messages to find the specific one
  })) as Message[];

  targetMessage = messages.find((msg) => msg._id === messageId) || null;

  if (!targetMessage) {
    console.error(`❌ Message with ID "${messageId}" not found in this chatroom`);
    console.error(`   Verify the message ID is correct and you have access to this chatroom`);
    process.exit(1);
  }

  // Call the taskStarted mutation
  try {
    const result = (await client.mutation(api.messages.taskStarted, {
      sessionId,
      chatroomId: chatroomId as Id<'chatroom_rooms'>,
      role,
      messageId: targetMessage._id,
      classification,
      // Include feature metadata if provided (validated above for new_feature)
      ...(title && { featureTitle: title.trim() }),
      ...(description && { featureDescription: description.trim() }),
      ...(techSpecs && { featureTechSpecs: techSpecs.trim() }),
    })) as { success: boolean; classification: string; reminder: string };

    console.log(`✅ Task acknowledged and classified`);
    console.log(`   Classification: ${classification}`);
    console.log(
      `   Message: "${targetMessage.content.substring(0, 80)}${targetMessage.content.length > 80 ? '...' : ''}"`
    );

    // Display the focused reminder from the backend
    if (result.reminder) {
      console.log(`\n💡 ${result.reminder}`);
    }
  } catch (error) {
    const err = error as Error;
    console.error(`❌ Failed to acknowledge task: ${err.message}`);
    process.exit(1);
  }
}
