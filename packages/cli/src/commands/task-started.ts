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
  messageId?: string;
  taskId?: string;
  // Feature metadata (required for new_feature classification)
  title?: string;
  description?: string;
  techSpecs?: string;
}

export async function taskStarted(chatroomId: string, options: TaskStartedOptions): Promise<void> {
  const client = await getConvexClient();
  const { role, classification, title, description, techSpecs, messageId, taskId } = options;

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

  if (messageId) {
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
  } else if (taskId) {
    // Find message associated with task ID
    const tasks = await client.query(api.tasks.getTasksByIds, {
      sessionId,
      taskIds: [taskId as Id<'chatroom_tasks'>],
    });

    if (!tasks || tasks.length === 0) {
      console.error(`❌ Task with ID "${taskId}" not found`);
      console.error(`   Verify the task ID is correct and you have access to this chatroom`);
      process.exit(1);
    }

    const task = tasks[0];
    if (!task.sourceMessageId) {
      console.error(`❌ Task "${taskId}" has no associated user message`);
      console.error(`   This task may have been created from the backlog`);
      process.exit(1);
    }

    // Get the specific message
    const messages = (await client.query(api.messages.list, {
      sessionId,
      chatroomId: chatroomId as Id<'chatroom_rooms'>,
      limit: 1000,
    })) as Message[];

    targetMessage = messages.find((msg) => msg._id === task.sourceMessageId) || null;

    if (!targetMessage) {
      console.error(`❌ Associated message not found for task "${taskId}"`);
      console.error(`   Message ID: ${task.sourceMessageId}`);
      process.exit(1);
    }
  } else {
    // Original behavior: find the most recent unclassified user message
    const messages = (await client.query(api.messages.list, {
      sessionId,
      chatroomId: chatroomId as Id<'chatroom_rooms'>,
      limit: 50,
    })) as Message[];

    // Find the most recent unclassified user message
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (
        msg.senderRole.toLowerCase() === 'user' &&
        msg.type === 'message' &&
        !msg.classification
      ) {
        targetMessage = msg;
        break;
      }
    }

    if (!targetMessage) {
      console.error(`❌ No unclassified user message found to acknowledge`);
      console.error(`   All user messages may already be classified.`);
      console.error(`   Use --message-id or --task-id to classify a specific message.`);
      console.error(`   Or use --message-id=<msgId> for a specific message.`);
      console.error(`   Or use --task-id=<taskId> for a task's associated message.`);
      process.exit(1);
    }
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
