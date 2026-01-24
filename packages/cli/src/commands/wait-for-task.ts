/**
 * Wait for tasks in a chatroom
 */

import {
  getWaitForTaskGuidance,
  getWaitForTaskReminder,
} from '@workspace/backend/prompts/base/cli/index.js';
import { taskStartedCommand } from '@workspace/backend/prompts/base/cli/task-started/command.js';
import { waitForTaskCommand } from '@workspace/backend/prompts/base/cli/wait-for-task/command.js';
import { getCliEnvPrefix } from '@workspace/backend/prompts/utils/env.js';

import { api, type Id, type Chatroom, type TaskWithMessage } from '../api.js';
import { DEFAULT_WAIT_TIMEOUT_MS, DEFAULT_ACTIVE_TIMEOUT_MS } from '../config.js';
import { getSessionId, getOtherSessionUrls } from '../infrastructure/auth/storage.js';
import {
  getConvexUrl,
  getConvexClient,
  getConvexWsClient,
} from '../infrastructure/convex/client.js';

interface WaitForTaskOptions {
  role: string;
  timeout?: number;
  duration?: string;
  silent?: boolean;
}

/**
 * Parse a duration string (e.g., "1m", "5m", "30s") into milliseconds.
 * Returns null if the format is invalid.
 */
export function parseDuration(duration: string): number | null {
  const match = duration
    .trim()
    .match(/^(\d+(?:\.\d+)?)\s*(s|sec|second|seconds|m|min|minute|minutes|h|hr|hour|hours)?$/i);
  if (!match) return null;

  const value = parseFloat(match[1]!);
  const unit = (match[2] || 's').toLowerCase();

  switch (unit) {
    case 's':
    case 'sec':
    case 'second':
    case 'seconds':
      return value * 1000;
    case 'm':
    case 'min':
    case 'minute':
    case 'minutes':
      return value * 60 * 1000;
    case 'h':
    case 'hr':
    case 'hour':
    case 'hours':
      return value * 60 * 60 * 1000;
    default:
      return null;
  }
}

export async function waitForTask(chatroomId: string, options: WaitForTaskOptions): Promise<void> {
  const client = await getConvexClient();
  const { role, timeout, silent } = options;

  // Get Convex URL and CLI env prefix for generating commands
  const convexUrl = getConvexUrl();
  const cliEnvPrefix = getCliEnvPrefix(convexUrl);

  // Get session ID for authentication
  const sessionId = getSessionId();
  if (!sessionId) {
    const otherUrls = getOtherSessionUrls();

    console.error(`❌ Not authenticated for: ${convexUrl}`);

    if (otherUrls.length > 0) {
      console.error(`\n💡 You have sessions for other environments:`);
      for (const url of otherUrls) {
        console.error(`   • ${url}`);
      }
      console.error(`\n   To use a different environment, set CHATROOM_CONVEX_URL:`);
      console.error(`   CHATROOM_CONVEX_URL=${otherUrls[0]} chatroom wait-for-task ...`);
      console.error(`\n   Or to authenticate for the current environment:`);
    }

    console.error(`   chatroom auth login`);
    process.exit(1);
  }

  // Validate chatroom ID format before query
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

  if (!/^[a-zA-Z0-9_]+$/.test(chatroomId)) {
    console.error(
      `❌ Invalid chatroom ID format: ID must contain only alphanumeric characters and underscores`
    );
    process.exit(1);
  }

  // Validate chatroom exists and user has access
  const chatroom = (await client.query(api.chatrooms.get, {
    sessionId,
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
  })) as Chatroom | null;

  if (!chatroom) {
    console.error(`❌ Chatroom ${chatroomId} not found or access denied`);
    process.exit(1);
  }

  // Calculate readyUntil timestamp for this session
  // If no timeout specified, use configured default (10 minutes)
  const effectiveTimeout = timeout || DEFAULT_WAIT_TIMEOUT_MS;
  const readyUntil = Date.now() + effectiveTimeout;

  // Join the chatroom with readyUntil timestamp
  await client.mutation(api.participants.join, {
    sessionId,
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
    role,
    readyUntil,
  });

  if (!silent) {
    console.log(`✅ Joined chatroom as "${role}"`);
  }

  // On first session, fetch and display the full initialization prompt from backend
  try {
    const convexUrl = getConvexUrl();
    const initPromptResult = (await client.query(api.messages.getInitPrompt, {
      sessionId,
      chatroomId: chatroomId as Id<'chatroom_rooms'>,
      role,
      convexUrl,
    })) as { prompt: string } | null;

    if (initPromptResult?.prompt) {
      console.log('');
      console.log('═'.repeat(50));
      console.log('📋 AGENT INITIALIZATION PROMPT');
      console.log('═'.repeat(50));
      console.log('');
      console.log(getWaitForTaskGuidance());
      console.log('');
      console.log('═'.repeat(50));
      console.log('');
      console.log(initPromptResult.prompt);
      console.log('');
      console.log('═'.repeat(50));
      console.log('');
    }
  } catch {
    // Fallback - init prompt not critical, continue without it
  }

  // Track if we've already processed a task (prevent duplicate processing)
  let taskProcessed = false;
  let unsubscribe: (() => void) | null = null;

  // Set up timeout - now always has a default value
  const timeoutHandle = setTimeout(() => {
    if (unsubscribe) unsubscribe();
    console.log(`\n${'─'.repeat(50)}`);
    console.log(`⚠️  RECONNECTION REQUIRED\n`);
    console.log(`Why: Session timeout reached (normal and expected behavior)`);
    console.log(`Impact: You are no longer listening for tasks`);
    console.log(`Action: Run this command immediately to resume availability\n`);
    console.log(waitForTaskCommand({ chatroomId, role, cliEnvPrefix }));
    console.log(`${'─'.repeat(50)}`);
    process.exit(0); // Exit with 0 since this is expected behavior
  }, effectiveTimeout);

  // Handle task processing when we receive pending tasks via subscription
  const handlePendingTasks = async (pendingTasks: TaskWithMessage[]) => {
    // Prevent duplicate processing
    if (taskProcessed) return;

    // Get the oldest pending task (first in array)
    const taskWithMessage = pendingTasks.length > 0 ? pendingTasks[0] : null;

    if (!taskWithMessage) {
      // No tasks yet, subscription will notify us when there are
      return;
    }

    const { task, message } = taskWithMessage;

    // Claim the task (transition: pending → acknowledged)
    // This is atomic and handles race conditions - only one agent can claim a task
    try {
      await client.mutation(api.tasks.claimTask, {
        sessionId,
        chatroomId: chatroomId as Id<'chatroom_rooms'>,
        role,
      });
    } catch (_claimError) {
      // Task was already claimed by another agent, subscription will update with new state
      console.log(`🔄 Task already claimed by another agent, continuing to wait...`);
      return;
    }

    // Mark as processed to prevent duplicate handling
    taskProcessed = true;

    // Also claim the message if it exists (for compatibility)
    if (message) {
      await client.mutation(api.messages.claimMessage, {
        sessionId,
        messageId: message._id,
        role,
      });
    }

    // SUCCESS: This agent has exclusive claim on the task
    if (unsubscribe) unsubscribe();
    clearTimeout(timeoutHandle);

    // Update participant status to active with activeUntil timeout
    // This gives the agent ~1 hour to complete the task before being considered crashed
    const activeUntil = Date.now() + DEFAULT_ACTIVE_TIMEOUT_MS;
    await client.mutation(api.participants.updateStatus, {
      sessionId,
      chatroomId: chatroomId as Id<'chatroom_rooms'>,
      role,
      status: 'active',
      expiresAt: activeUntil,
    });

    // Handle interrupt (if message is interrupt type)
    if (message && message.type === 'interrupt') {
      console.log(`\n${'─'.repeat(50)}`);
      console.log(`⚠️  RECONNECTION REQUIRED\n`);
      console.log(`Why: Interrupt message received from team`);
      console.log(`Impact: You are no longer listening for tasks`);
      console.log(`Action: Run this command immediately to resume availability\n`);
      console.log(waitForTaskCommand({ chatroomId, role, cliEnvPrefix }));
      console.log(`${'─'.repeat(50)}`);
      process.exit(0);
    }

    // Get the complete task delivery prompt from backend
    const taskDeliveryPrompt = await client.query(api.messages.getTaskDeliveryPrompt, {
      sessionId,
      chatroomId: chatroomId as Id<'chatroom_rooms'>,
      role,
      taskId: task._id,
      messageId: message?._id,
      convexUrl,
    });

    // Display explicit task and message IDs for clarity
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🆔 TASK INFORMATION`);
    console.log(`${'='.repeat(60)}`);
    console.log(`Task ID: ${task._id}`);
    if (message) {
      console.log(`Message ID: ${message._id}`);
    }
    console.log(`\n📋 NEXT STEPS`);
    console.log(`${'='.repeat(60)}`);

    // Only show task-started instructions for user messages (entry point classification)
    // Handoff messages from other agents don't need classification
    const isUserMessage = message && message.senderRole.toLowerCase() === 'user';

    if (isUserMessage) {
      console.log(`To acknowledge and classify this message, run:\n`);

      // Show basic command structure
      const baseCmd = taskStartedCommand({
        chatroomId,
        role,
        taskId: task._id,
        classification: 'question',
        cliEnvPrefix,
      }).replace(
        '--origin-message-classification=question',
        '--origin-message-classification=<type>'
      );
      console.log(baseCmd);

      // Show classification-specific requirements
      console.log(`\n📝 Classification Requirements:`);
      console.log(`   • question: No additional fields required`);
      console.log(`   • follow_up: No additional fields required`);
      console.log(`   • new_feature: REQUIRES --title, --description, --tech-specs`);

      // Show complete new_feature example
      console.log(`\n💡 Example for new_feature:`);
      console.log(
        taskStartedCommand({
          chatroomId,
          role,
          taskId: task._id,
          classification: 'new_feature',
          title: '<title>',
          description: '<description>',
          techSpecs: '<tech-specs>',
          cliEnvPrefix,
        })
      );

      console.log(`\nClassification types: question, new_feature, follow_up`);
    } else if (message) {
      console.log(`Task handed off from ${message.senderRole}.`);
      console.log(
        `The original user message was already classified - you can start work immediately.`
      );
    } else {
      console.log(`No message found. Task ID: ${task._id}`);
    }

    console.log(`${'='.repeat(60)}`);

    // Print pinned section with primary user directive
    const originMessage = taskDeliveryPrompt.json?.contextWindow?.originMessage;
    if (originMessage && originMessage.senderRole.toLowerCase() === 'user') {
      console.log(`\n## 📍 Pinned`);
      console.log(`### Primary User Directive`);
      console.log(`<user-message>`);
      console.log(originMessage.content);

      // Show attached tasks if available
      if (originMessage.attachedTasks && originMessage.attachedTasks.length > 0) {
        console.log(`\nATTACHED BACKLOG (${originMessage.attachedTasks.length})`);
        for (const attachedTask of originMessage.attachedTasks) {
          console.log(`${attachedTask.content}`);
        }
      }

      console.log(`</user-message>`);

      // Show inferred task status
      const existingClassification = originMessage.classification;
      if (existingClassification) {
        console.log(`\n### Inferred Task`);
        console.log(`Classification: ${existingClassification}`);
      } else {
        console.log(`\n### Inferred Task`);
        console.log(`Not created yet. Run \`chatroom task-started …\` to specify task.`);
      }
      console.log(`${'='.repeat(60)}`);
    }

    // Print human-readable sections
    console.log(`\n${taskDeliveryPrompt.humanReadable}`);

    // Add reminder about wait-for-task
    console.log(`\n${'='.repeat(60)}`);
    console.log(getWaitForTaskReminder());
    console.log(`${'='.repeat(60)}`);

    process.exit(0);
  };

  // Use websocket subscription instead of polling
  // This is more efficient - we only receive updates when data changes
  const wsClient = await getConvexWsClient();
  const subscription = wsClient.onUpdate(
    api.tasks.getPendingTasksForRole,
    {
      sessionId,
      chatroomId: chatroomId as Id<'chatroom_rooms'>,
      role,
    },
    (pendingTasks: TaskWithMessage[]) => {
      handlePendingTasks(pendingTasks).catch((error) => {
        console.error(`❌ Error processing task: ${(error as Error).message}`);
      });
    }
  );
  unsubscribe = subscription;

  // IMPORTANT: Check for existing pending tasks immediately
  // The onUpdate callback fires "soon after" registration, not immediately
  // This ensures pending tasks are processed right away without delay
  const currentPendingTasks = subscription.getCurrentValue();
  if (currentPendingTasks && currentPendingTasks.length > 0) {
    handlePendingTasks(currentPendingTasks).catch((error) => {
      console.error(`❌ Error processing initial task: ${(error as Error).message}`);
    });
  }

  // Handle interrupt signals - These are UNEXPECTED terminations that require immediate restart
  const handleSignal = (_signal: string) => {
    if (unsubscribe) unsubscribe();
    clearTimeout(timeoutHandle);
    console.log(`\n${'─'.repeat(50)}`);
    console.log(`⚠️  RECONNECTION REQUIRED\n`);
    console.log(`Why: Process interrupted (unexpected termination)`);
    console.log(`Impact: You are no longer listening for tasks`);
    console.log(`Action: Run this command immediately to resume availability\n`);
    console.log(waitForTaskCommand({ chatroomId, role, cliEnvPrefix }));
    console.log(`${'─'.repeat(50)}`);
    process.exit(0);
  };

  // SIGINT: Ctrl+C or interrupt signal
  process.on('SIGINT', () => handleSignal('SIGINT'));

  // SIGTERM: Graceful termination (e.g., container shutdown, timeout)
  process.on('SIGTERM', () => handleSignal('SIGTERM'));

  // SIGHUP: Hang up signal (terminal closed)
  process.on('SIGHUP', () => handleSignal('SIGHUP'));
}
