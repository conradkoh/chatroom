/**
 * Context commands for understanding chatroom state
 *
 * Includes:
 * - readContext: Read conversation history and task status
 * - newContext: Create a new explicit context (replaces pinned message)
 * - listContexts: List recent contexts for a chatroom
 * - inspectContext: View a specific context with details
 */

import type { ContextDeps } from './deps.js';
import { api, type Id } from '../../api.js';
import { getSessionId, getOtherSessionUrls } from '../../infrastructure/auth/storage.js';
import { getConvexClient, getConvexUrl } from '../../infrastructure/convex/client.js';
import { sanitizeForTerminal, sanitizeUnknownForTerminal } from '../../utils/terminal-safety.js';
import { getErrorMessage } from '../../utils/convex-error.js';

// ─── Re-exports for testing ────────────────────────────────────────────────

export type { ContextDeps } from './deps.js';

// ─── Default Deps Factory ──────────────────────────────────────────────────

async function createDefaultDeps(): Promise<ContextDeps> {
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

// ─── Commands ─────────────────────────────────────────────────────────────

/**
 * Read context for a specific role.
 * Shows recent conversation history with task information.
 */
export async function readContext(
  chatroomId: string,
  options: { role: string },
  deps?: ContextDeps
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
    const context = await d.backend.query(api.messages.getContextForRole, {
      sessionId,
      chatroomId: chatroomId as Id<'chatroom_rooms'>,
      role: options.role,
    });

    if (context.messages.length === 0 && !context.currentContext) {
      console.log(`<context role="${options.role}">`);
      console.log(`\n📭 No context available`);
      console.log('</context>');
      return;
    }

    console.log(`<context role="${options.role}">`);
    console.log(`\n📚 CONTEXT FOR ${options.role.toUpperCase()}`);
    console.log('═'.repeat(60));

    // Display the pinned context if available
    if (context.currentContext) {
      console.log(`\n📌 Current Context:`);
      console.log(`   Created by: ${context.currentContext.createdBy}`);
      console.log(`   Created at: ${new Date(context.currentContext.createdAt).toLocaleString()}`);
      console.log(`   Content:`);
      const safeContextContent = sanitizeForTerminal(context.currentContext.content);
      console.log(
        safeContextContent
          .split('\n')
          .map((l) => `      ${l}`)
          .join('\n')
      );
      console.log('─'.repeat(60));
    }

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
      // Build the opening <message> tag with attributes
      const toAttr = message.targetRole ? ` to="${message.targetRole}"` : '';
      const classAttr = message.classification ? ` classification="${message.classification}"` : '';
      console.log(
        `<message id="${message._id}" from="${message.senderRole}"${toAttr} type="${message.type}"${classAttr}>`
      );

      if (message.featureTitle) {
        console.log(`   Feature: ${sanitizeForTerminal(message.featureTitle)}`);
      }

      // Show task info if available
      if (message.taskId) {
        console.log(`   Task:`);
        console.log(`      ID: ${message.taskId}`);
        if (message.taskStatus) {
          console.log(`      Status: ${message.taskStatus}`);
        }
        if (message.taskContent) {
          const safeTaskContent = sanitizeForTerminal(message.taskContent);
          console.log(`      Content:`);
          console.log(`      <task-content>`);
          console.log(
            safeTaskContent
              .split('\n')
              .map((l) => `      ${l}`)
              .join('\n')
          );
          console.log(`      </task-content>`);
        }
      }

      // Show attached tasks if available
      if (message.attachedTasks && message.attachedTasks.length > 0) {
        console.log(`   Attachments:`);
        for (const task of message.attachedTasks) {
          console.log(`      🔹 Task ID: ${task._id}`);
          console.log(`         Type: Task`);
          const contentLines = sanitizeForTerminal(task.content).split('\n');
          console.log(`         Content:`);
          console.log(`         <task-content>`);
          for (const line of contentLines) {
            console.log(`         ${line}`);
          }
          console.log(`         </task-content>`);
        }
      }

      // Show full message content
      console.log(`   Content:`);
      console.log(`   <message-content>`);
      const safeMessageContent = sanitizeForTerminal(message.content);
      console.log(
        safeMessageContent
          .split('\n')
          .map((l) => `      ${l}`)
          .join('\n')
      );
      console.log(`   </message-content>`);
      console.log(`</message>`);
    }

    console.log('\n' + '═'.repeat(60));
    console.log('</context>');
  } catch (err) {
    console.error(
      `❌ Failed to read context: ${sanitizeUnknownForTerminal(getErrorMessage(err))}`
    );
    process.exit(1);
    return;
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
    triggerMessageId?: string;
  },
  deps?: ContextDeps
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

  // Validate content is not empty
  if (!options.content || options.content.trim().length === 0) {
    console.error(`❌ Context content cannot be empty`);
    process.exit(1);
  }

  try {
    const contextId = await d.backend.mutation(api.contexts.createContext, {
      sessionId,
      chatroomId: chatroomId as Id<'chatroom_rooms'>,
      content: options.content,
      role: options.role,
      triggerMessageId: options.triggerMessageId as Id<'chatroom_messages'> | undefined,
    });

    console.log(`✅ Context created successfully`);
    console.log(`   Context ID: ${contextId}`);
    console.log(`   Created by: ${options.role}`);
    console.log(`\n📌 This context is now pinned for all agents in this chatroom.`);
  } catch (err) {
    // Check for structured ConvexError with a known code
    const errData = (
      err as {
        data?: {
          code?: string;
          message?: string;
          existingContext?: { content: string; createdAt: number; createdBy: string };
        };
      }
    ).data;
    if (errData?.code === 'CONTEXT_NO_HANDOFF_SINCE_LAST_CONTEXT' && errData.existingContext) {
      const { content, createdAt, createdBy } = errData.existingContext;
      console.error(
        `❌ Cannot create new context: no handoff sent since last context was created.`
      );
      console.error(`\n📌 Current Context (resume from here):`);
      console.error(`   Created by: ${sanitizeForTerminal(createdBy)}`);
      console.error(`   Created at: ${new Date(createdAt).toLocaleString()}`);
      console.error(`   Content:`);
      const safeContent = sanitizeForTerminal(content);
      console.error(
        safeContent
          .split('\n')
          .map((l) => `      ${l}`)
          .join('\n')
      );
      console.error(`\n💡 Send a handoff first, then create a new context.`);
      process.exit(1);
      return;
    }
    console.error(`❌ Failed to create context: ${getErrorMessage(err)}`);
    process.exit(1);
    return;
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
  },
  deps?: ContextDeps
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
    const contexts = await d.backend.query(api.contexts.listContexts, {
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
      const safeContent = sanitizeForTerminal(context.content);
      const truncatedContent =
        safeContent.length > 200 ? safeContent.slice(0, 200) + '...' : safeContent;
      console.log(
        truncatedContent
          .split('\n')
          .map((l) => `      ${l}`)
          .join('\n')
      );
    }

    console.log('\n' + '═'.repeat(60));
  } catch (err) {
    console.error(
      `❌ Failed to list contexts: ${sanitizeUnknownForTerminal(getErrorMessage(err))}`
    );
    process.exit(1);
    return;
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
  },
  deps?: ContextDeps
): Promise<void> {
  const d = deps ?? (await createDefaultDeps());

  // Get session ID for authentication
  const sessionId = d.session.getSessionId();
  if (!sessionId) {
    console.error(`❌ Not authenticated. Please run: chatroom auth login`);
    process.exit(1);
  }

  try {
    const context = await d.backend.query(api.contexts.getContext, {
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
    console.log(sanitizeForTerminal(context.content));
    console.log('─'.repeat(60));

    console.log(`\n💡 To create a new context:`);
    console.log(
      `   chatroom context new --chatroom-id=${chatroomId} --role=${options.role} --content="Your updated summary"`
    );

    console.log('\n' + '═'.repeat(60));
  } catch (err) {
    console.error(
      `❌ Failed to inspect context: ${sanitizeUnknownForTerminal(getErrorMessage(err))}`
    );
    process.exit(1);
    return;
  }
}
