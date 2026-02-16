/**
 * Context commands for understanding chatroom state
 *
 * Includes:
 * - readContext: Read conversation history and task status
 * - newContext: Create a new explicit context (replaces pinned message)
 * - listContexts: List recent contexts for a chatroom
 * - inspectContext: View a specific context with details
 */

import { api, type Id } from '../api.js';
import { getSessionId } from '../infrastructure/auth/storage.js';
import { getConvexClient } from '../infrastructure/convex/client.js';

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
    const context = await client.query(api.messages.getContextForRole, {
      sessionId,
      chatroomId: chatroomId as Id<'chatroom_rooms'>,
      role: options.role,
    });

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
          console.log(
            `      Content: ${message.taskContent
              .split('\n')
              .map((l, i) => (i === 0 ? l : `      ${l}`))
              .join('\n')}`
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

/**
 * Create a new explicit context for a chatroom.
 * This replaces the pinned message system with explicit context management.
 */
export async function newContext(
  chatroomId: string,
  options: {
    role: string;
    content: string;
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

  // Validate content is not empty
  if (!options.content || options.content.trim().length === 0) {
    console.error(`❌ Context content cannot be empty`);
    process.exit(1);
  }

  try {
    const contextId = await client.mutation(api.contexts.createContext, {
      sessionId,
      chatroomId: chatroomId as Id<'chatroom_rooms'>,
      content: options.content,
      role: options.role,
    });

    console.log(`✅ Context created successfully`);
    console.log(`   Context ID: ${contextId}`);
    console.log(`   Created by: ${options.role}`);
    console.log(`\n📌 This context is now pinned for all agents in this chatroom.`);
  } catch (err) {
    console.error(`❌ Failed to create context: ${(err as Error).message}`);
    process.exit(1);
  }
}

/**
 * List recent contexts for a chatroom.
 */
export async function listContexts(
  chatroomId: string,
  options: {
    role: string;
    limit?: number;
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
    const contexts = await client.query(api.contexts.listContexts, {
      sessionId,
      chatroomId: chatroomId as Id<'chatroom_rooms'>,
      limit: options.limit ?? 10,
    });

    if (contexts.length === 0) {
      console.log(`\n📭 No contexts found for this chatroom`);
      console.log(`\n💡 Create a context with:`);
      console.log(
        `   chatroom context new --chatroom-id=${chatroomId} --role=${options.role} --content="Your context summary"`
      );
      return;
    }

    console.log(`\n📚 CONTEXTS (${contexts.length} found)`);
    console.log('═'.repeat(60));

    for (const context of contexts) {
      const timestamp = new Date(context.createdAt).toLocaleString();

      console.log(`\n🔹 Context ID: ${context._id}`);
      console.log(`   Created by: ${context.createdBy}`);
      console.log(`   Created at: ${timestamp}`);
      if (context.messageCountAtCreation !== undefined) {
        console.log(`   Messages at creation: ${context.messageCountAtCreation}`);
      }
      console.log(`   Content:`);
      // Truncate to first 200 chars for list view
      const truncatedContent =
        context.content.length > 200 ? context.content.slice(0, 200) + '...' : context.content;
      console.log(
        truncatedContent
          .split('\n')
          .map((l) => `      ${l}`)
          .join('\n')
      );
    }

    console.log('\n' + '═'.repeat(60));
  } catch (err) {
    console.error(`❌ Failed to list contexts: ${(err as Error).message}`);
    process.exit(1);
  }
}

/**
 * Inspect a specific context with staleness information.
 */
export async function inspectContext(
  chatroomId: string,
  options: {
    role: string;
    contextId: string;
  }
): Promise<void> {
  const client = await getConvexClient();

  // Get session ID for authentication
  const sessionId = getSessionId();
  if (!sessionId) {
    console.error(`❌ Not authenticated. Please run: chatroom auth login`);
    process.exit(1);
  }

  try {
    const context = await client.query(api.contexts.getContext, {
      sessionId,
      contextId: options.contextId as Id<'chatroom_contexts'>,
    });

    console.log(`\n📋 CONTEXT DETAILS`);
    console.log('═'.repeat(60));

    console.log(`\n🔹 Context ID: ${context._id}`);
    console.log(`   Created by: ${context.createdBy}`);
    console.log(`   Created at: ${new Date(context.createdAt).toLocaleString()}`);

    // Staleness information
    console.log(`\n📊 Staleness:`);
    console.log(`   Messages since context: ${context.messagesSinceContext}`);
    console.log(`   Time elapsed: ${context.elapsedHours.toFixed(1)} hours`);

    // Staleness warnings
    if (context.messagesSinceContext >= 10) {
      console.log(`\n⚠️  Many messages since this context was created.`);
      console.log(`   Consider creating a new context with an updated summary.`);
    }
    if (context.elapsedHours >= 24) {
      console.log(`\n⚠️  This context is over 24 hours old.`);
      console.log(`   Consider creating a new context with an updated summary.`);
    }

    console.log(`\n📝 Content:`);
    console.log('─'.repeat(60));
    console.log(context.content);
    console.log('─'.repeat(60));

    console.log(`\n💡 To create a new context:`);
    console.log(
      `   chatroom context new --chatroom-id=${chatroomId} --role=${options.role} --content="Your updated summary"`
    );

    console.log('\n' + '═'.repeat(60));
  } catch (err) {
    console.error(`❌ Failed to inspect context: ${(err as Error).message}`);
    process.exit(1);
  }
}
