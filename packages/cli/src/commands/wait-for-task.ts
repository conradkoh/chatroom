/**
 * Wait for tasks in a chatroom
 */

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

/**
 * Format milliseconds into a human-readable duration string.
 */
function formatDuration(ms: number): string {
  if (ms >= 60 * 60 * 1000) {
    const hours = Math.round((ms / (60 * 60 * 1000)) * 10) / 10;
    return `${hours}h`;
  }
  if (ms >= 60 * 1000) {
    const minutes = Math.round((ms / (60 * 1000)) * 10) / 10;
    return `${minutes}m`;
  }
  const seconds = Math.round((ms / 1000) * 10) / 10;
  return `${seconds}s`;
}

/**
 * Print the wait-for-task reminder - short but forceful.
 */
function printWaitReminder(chatroomId: string, role: string): void {
  console.log(`${'─'.repeat(50)}`);
  console.log(
    `⚠️  ALWAYS run \`wait-for-task\` after handoff. If it times out, run it again immediately.`
  );
  console.log(`    chatroom wait-for-task ${chatroomId} --role=${role}`);
  console.log(`${'─'.repeat(50)}`);
}

export async function waitForTask(chatroomId: string, options: WaitForTaskOptions): Promise<void> {
  const client = await getConvexClient();
  const { role, timeout, silent } = options;

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
    const initPromptResult = (await client.query(api.messages.getInitPrompt, {
      sessionId,
      chatroomId: chatroomId as Id<'chatroom_rooms'>,
      role,
    })) as { prompt: string } | null;

    if (initPromptResult?.prompt) {
      console.log('');
      console.log('═'.repeat(50));
      console.log('📋 AGENT INITIALIZATION PROMPT');
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

  const durationDisplay = formatDuration(effectiveTimeout);
  console.log(`⏳ Waiting for tasks (duration: ${durationDisplay})...`);
  console.log('');
  printWaitReminder(chatroomId, role);
  console.log('');

  // Track if we've already processed a task (prevent duplicate processing)
  let taskProcessed = false;
  let unsubscribe: (() => void) | null = null;

  // Set up timeout - now always has a default value
  const timeoutHandle = setTimeout(() => {
    if (unsubscribe) unsubscribe();
    console.log(`\n${'─'.repeat(50)}`);
    console.log(`The connection to the server was closed. Please run the command:`);
    console.log(`chatroom wait-for-task ${chatroomId} --role=${role}`);
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

    // Start the task (transition to in_progress)
    // This is atomic and handles race conditions - only one agent can start a task
    try {
      await client.mutation(api.tasks.startTask, {
        sessionId,
        chatroomId: chatroomId as Id<'chatroom_rooms'>,
        role,
      });
    } catch (_startError) {
      // Task was already started by another agent, subscription will update with new state
      console.log(`🔄 Task already started by another agent, continuing to wait...`);
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
      console.log(`The connection to the server was closed. Please run the command:`);
      console.log(`chatroom wait-for-task ${chatroomId} --role=${role}`);
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

    // Show the exact command to run with explicit IDs
    if (message) {
      console.log(`To acknowledge and classify this message, run:`);
      console.log(
        `chatroom task-started ${chatroomId} --role=${role} --classification=<type> --message-id=${message._id}`
      );
    } else {
      console.log(`To acknowledge and classify the task, run:`);
      console.log(
        `chatroom task-started ${chatroomId} --role=${role} --classification=<type> --task-id=${task._id}`
      );
    }

    console.log(`\nClassification types: question, new_feature, follow_up`);
    console.log(`${'='.repeat(60)}`);

    // Print human-readable sections
    console.log(`\n${taskDeliveryPrompt.humanReadable}`);

    process.exit(0);
  };

  // Use websocket subscription instead of polling
  // This is more efficient - we only receive updates when data changes
  const wsClient = await getConvexWsClient();
  unsubscribe = wsClient.onUpdate(
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

  // Handle interrupt signals - These are UNEXPECTED terminations that require immediate restart
  const handleSignal = (_signal: string) => {
    if (unsubscribe) unsubscribe();
    clearTimeout(timeoutHandle);
    console.log(`\n${'─'.repeat(50)}`);
    console.log(`The connection to the server was closed. Please run the command:`);
    console.log(`chatroom wait-for-task ${chatroomId} --role=${role}`);
    console.log(`${'─'.repeat(50)}`);
    process.exit(0);
  };

  // SIGINT: Ctrl+C or interrupt signal
  process.on('SIGINT', () => handleSignal('SIGINT'));

  // SIGTERM: Graceful termination (e.g., container shutdown, AI agent timeout)
  process.on('SIGTERM', () => handleSignal('SIGTERM'));

  // SIGHUP: Hang up signal (terminal closed)
  process.on('SIGHUP', () => handleSignal('SIGHUP'));
}
