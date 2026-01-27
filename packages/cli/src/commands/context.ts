/**
 * Context commands for understanding chatroom state
 */

import { api, type Id } from '../api.js';
import { getSessionId } from '../infrastructure/auth/storage.js';
import { getConvexClient } from '../infrastructure/convex/client.js';

interface ContextMessage {
  _id: string;
  _creationTime: number;
  senderRole: string;
  content: string;
  type: string;
  classification?: string;
  featureTitle?: string;
  taskId?: string;
  taskStatus?: string;
  taskContent?: string;
  attachedTasks?: {
    _id: string;
    content: string;
    status: string;
    createdAt: number;
  }[];
}

/**
 * Read context for a specific role.
 * Shows recent conversation history with task information.
 */
export async function readContext(
  chatroomId: string,
  options: {
    role: string;
  }
): Promise<void> {
  const client = await getConvexClient();

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

  try {
    const context = (await client.query(api.messages.getContextForRole, {
      sessionId,
      chatroomId: chatroomId as Id<'chatroom_rooms'>,
      role: options.role,
    })) as {
      messages: ContextMessage[];
      originMessage: ContextMessage | null;
      classification: string | null;
      pendingTasksForRole: number;
    };

    if (context.messages.length === 0) {
      console.log(`\n📭 No context available`);
      return;
    }

    console.log(`\n📚 CONTEXT FOR ${options.role.toUpperCase()}`);
    console.log('═'.repeat(60));

    if (context.originMessage) {
      console.log(`\n🎯 Origin Message:`);
      console.log(`   ID: ${context.originMessage._id}`);
      console.log(`   Time: ${new Date(context.originMessage._creationTime).toLocaleString()}`);
      if (context.classification) {
        console.log(`   Classification: ${context.classification.toUpperCase()}`);
      }
      if (context.originMessage.featureTitle) {
        console.log(`   Feature: ${context.originMessage.featureTitle}`);
      }
    }

    console.log(`\n📊 Status:`);
    console.log(`   Messages in context: ${context.messages.length}`);
    console.log(`   Pending tasks for ${options.role}: ${context.pendingTasksForRole}`);

    console.log(`\n💬 Chat History:`);
    console.log('─'.repeat(60));

    for (const message of context.messages) {
      const timestamp = new Date(message._creationTime).toLocaleString();
      const classificationBadge = message.classification
        ? ` [${message.classification.toUpperCase()}]`
        : '';

      console.log(`\n🔹 Message ID: ${message._id}`);
      console.log(`   Time: ${timestamp}`);
      console.log(`   From: ${message.senderRole}`);
      console.log(`   Type: ${message.type}${classificationBadge}`);

      if (message.featureTitle) {
        console.log(`   Feature: ${message.featureTitle}`);
      }

      // Show task info if available
      if (message.taskId) {
        console.log(`   Task:`);
        console.log(`      ID: ${message.taskId}`);
        if (message.taskStatus) {
          console.log(`      Status: ${message.taskStatus}`);
        }
        if (message.taskContent) {
          const contentLines = message.taskContent.split('\n');
          const preview = contentLines[0].substring(0, 80);
          console.log(
            `      Content: ${preview}${contentLines[0].length > 80 || contentLines.length > 1 ? '...' : ''}`
          );
        }
      }

      // Show attached tasks if available
      if (message.attachedTasks && message.attachedTasks.length > 0) {
        console.log(`   Attachments:`);
        for (const task of message.attachedTasks) {
          console.log(`      🔹 Task ID: ${task._id}`);
          console.log(`         Type: Task`);
          const contentLines = task.content.split('\n');
          // Show first line as preview
          console.log(`         Content: ${contentLines[0]}`);
          // Show remaining lines indented
          if (contentLines.length > 1) {
            for (let i = 1; i < contentLines.length; i++) {
              console.log(`         ${contentLines[i]}`);
            }
          }
        }
      }

      // Show full message content
      console.log(`   Content:`);
      console.log(
        message.content
          .split('\n')
          .map((l) => `      ${l}`)
          .join('\n')
      );
    }

    console.log('\n' + '═'.repeat(60));
  } catch (err) {
    console.error(`❌ Failed to read context: ${(err as Error).message}`);
    process.exit(1);
  }
}
