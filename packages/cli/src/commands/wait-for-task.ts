/**
 * Wait for tasks in a chatroom
 */

import {
  api,
  type Id,
  type Chatroom,
  type Participant,
  type ContextWindow,
  type RolePromptResponse,
  type TaskWithMessage,
} from '../api.js';
import { WAIT_POLL_INTERVAL_MS, MAX_SILENT_ERRORS, DEFAULT_WAIT_TIMEOUT_MS } from '../config.js';
import { getSessionId } from '../infrastructure/auth/storage.js';
import { getConvexClient } from '../infrastructure/convex/client.js';

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
  const { role, timeout, duration, silent } = options;

  // Get session ID for authentication
  const sessionId = getSessionId();
  if (!sessionId) {
    console.error(`❌ Not authenticated. Please run: chatroom auth login`);
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
  const durationDisplay = formatDuration(effectiveTimeout);
  console.log(`⏳ Waiting for tasks (duration: ${durationDisplay})...`);
  console.log('');
  printWaitReminder(chatroomId, role);
  console.log('');

  // Track errors for better debugging with exponential backoff
  let consecutiveErrors = 0;
  let currentPollInterval = WAIT_POLL_INTERVAL_MS;
  let pollTimeout: ReturnType<typeof setTimeout>;

  // Set up timeout - now always has a default value
  const timeoutHandle = setTimeout(() => {
    if (pollTimeout) clearTimeout(pollTimeout);
    const durationDisplay = duration || formatDuration(effectiveTimeout);
    const command = `chatroom wait-for-task ${chatroomId} --role=${role}${duration ? ` --duration="${duration}"` : ''}`;
    console.log(`\n✅ WAIT SESSION COMPLETE AFTER ${durationDisplay} of waiting`);
    console.log(`Please continue listening by running \`${command}\``);
    process.exit(0); // Exit with 0 since this is expected behavior
  }, effectiveTimeout);

  // Polling function with exponential backoff
  const poll = async () => {
    try {
      // Poll for pending tasks instead of messages
      const pendingTasks = (await client.query(api.tasks.getPendingTasksForRole, {
        sessionId,
        chatroomId: chatroomId as Id<'chatroom_rooms'>,
        role,
      })) as TaskWithMessage[];

      // Get the oldest pending task (first in array)
      const taskWithMessage = pendingTasks.length > 0 ? pendingTasks[0] : null;

      if (taskWithMessage) {
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
          // Task was already started by another agent
          console.log(`🔄 Task already started by another agent, continuing to wait...`);
          pollTimeout = setTimeout(poll, currentPollInterval);
          return;
        }

        // Also claim the message if it exists (for compatibility)
        if (message) {
          await client.mutation(api.messages.claimMessage, {
            sessionId,
            messageId: message._id,
            role,
          });
        }

        // SUCCESS: This agent has exclusive claim on the task
        if (pollTimeout) clearTimeout(pollTimeout);
        clearTimeout(timeoutHandle);

        // Update participant status to active
        await client.mutation(api.participants.updateStatus, {
          sessionId,
          chatroomId: chatroomId as Id<'chatroom_rooms'>,
          role,
          status: 'active',
        });

        // Get current chatroom state
        const chatroomData = (await client.query(api.chatrooms.get, {
          sessionId,
          chatroomId: chatroomId as Id<'chatroom_rooms'>,
        })) as Chatroom | null;

        const participants = (await client.query(api.participants.list, {
          sessionId,
          chatroomId: chatroomId as Id<'chatroom_rooms'>,
        })) as Participant[];

        // Handle interrupt (if message is interrupt type)
        if (message && message.type === 'interrupt') {
          console.log(`\n${'═'.repeat(50)}`);
          console.log(`⚠️  INTERRUPT RECEIVED`);
          console.log(`${'═'.repeat(50)}`);
          console.log(`Message: ${message.content}`);
          console.log(`\nAll agents have been reset to idle state.`);
          console.log(`Rejoin the chatroom to continue participating.`);
          process.exit(0);
        }

        // Use message content if available, otherwise task content
        const displayContent = message?.content || task.content;
        const senderRole = message?.senderRole || task.createdBy;
        const messageType = message?.type || 'message';
        const targetRole = message?.targetRole;

        // Print message details
        console.log(`\n${'═'.repeat(50)}`);
        console.log(`📨 MESSAGE RECEIVED`);
        console.log(`${'═'.repeat(50)}`);
        console.log(`From: ${senderRole}`);
        console.log(`Type: ${messageType}`);
        if (targetRole) {
          console.log(`To: ${targetRole}`);
        }
        console.log(`\n📄 Content:\n${displayContent}`);

        // Print chatroom state
        console.log(`\n${'─'.repeat(50)}`);
        console.log(`📋 CHATROOM STATE`);
        console.log(`${'─'.repeat(50)}`);
        console.log(`Chatroom ID: ${chatroomId}`);
        if (chatroomData && chatroomData.teamRoles && chatroomData.teamRoles.length > 0) {
          console.log(
            `Team: ${chatroomData.teamName || 'Unknown'} (${chatroomData.teamRoles.join(', ')})`
          );
        }
        console.log(`\nParticipants:`);

        for (const p of participants) {
          const youMarker = p.role.toLowerCase() === role.toLowerCase() ? ' (you)' : '';
          const statusIcon = p.status === 'active' ? '🔵' : p.status === 'waiting' ? '🟢' : '⚪';
          const availableMarker =
            p.status === 'waiting' && p.role.toLowerCase() !== role.toLowerCase()
              ? ' ✓ available'
              : '';
          console.log(`  ${statusIcon} ${p.role}${youMarker} - ${p.status}${availableMarker}`);
        }

        // Get role prompt (includes allowed roles, classification, and workflow guidance)
        const rolePromptInfo = (await client.query(api.messages.getRolePrompt, {
          sessionId,
          chatroomId: chatroomId as Id<'chatroom_rooms'>,
          role,
        })) as RolePromptResponse;

        // Get context window (latest non-follow-up message + all messages after)
        const contextWindow = (await client.query(api.messages.getContextWindow, {
          sessionId,
          chatroomId: chatroomId as Id<'chatroom_rooms'>,
        })) as ContextWindow;

        // Determine if classification is needed
        const needsClassification =
          rolePromptInfo.currentClassification === null && senderRole.toLowerCase() === 'user';

        // Print next steps
        console.log(`\n${'─'.repeat(50)}`);
        console.log(`📝 NEXT STEPS`);
        console.log(`${'─'.repeat(50)}`);

        // Show classification step if needed
        if (needsClassification) {
          console.log(`\n1️⃣ First, classify this user message:\n`);
          console.log(`  chatroom task-started ${chatroomId} \\`);
          console.log(`    --role=${role} \\`);
          console.log(`    --classification=<question|new_feature|follow_up>\n`);
          console.log(`   Options:`);
          console.log(`     question    - User asking a question`);
          console.log(`     new_feature - New feature request (requires review)`);
          console.log(`     follow_up   - Follow-up to previous task\n`);
          console.log(`2️⃣ When your task is complete, run:\n`);
        } else {
          console.log(`When your task is complete, run:\n`);
        }

        console.log(`  chatroom handoff ${chatroomId} \\`);
        console.log(`    --role=${role} \\`);
        console.log(`    --message="<summary of what you accomplished>" \\`);
        console.log(`    --next-role=<target>\n`);

        // Print reminder
        printWaitReminder(chatroomId, role);

        // Output role-specific prompt/guidance
        console.log(`${'─'.repeat(50)}`);
        console.log(`📋 ROLE GUIDANCE`);
        console.log(`${'─'.repeat(50)}`);
        console.log(rolePromptInfo.prompt);

        // Output JSON for parsing
        console.log(`\n${'─'.repeat(50)}`);
        console.log(`📊 MESSAGE DATA (JSON)`);
        console.log(`${'─'.repeat(50)}`);

        // Build classification commands object
        const classificationCommands = {
          question: `chatroom task-started ${chatroomId} --role=${role} --classification=question`,
          new_feature: `chatroom task-started ${chatroomId} --role=${role} --classification=new_feature --title="<title>" --description="<description>" --tech-specs="<specifications>"`,
          follow_up: `chatroom task-started ${chatroomId} --role=${role} --classification=follow_up`,
        };

        // Build context commands for question classification
        const contextCommands =
          rolePromptInfo.currentClassification === 'question'
            ? [
                `chatroom feature list ${chatroomId} --limit=5`,
                `chatroom backlog list ${chatroomId} --role=${role}`,
              ]
            : undefined;

        const jsonOutput = {
          message: {
            id: message?._id || task._id,
            senderRole: senderRole,
            content: displayContent,
            type: messageType,
          },
          task: {
            id: task._id,
            status: task.status,
            createdBy: task.createdBy,
            queuePosition: task.queuePosition,
          },
          chatroom: {
            id: chatroomId,
            participants: participants.map((p) => ({
              role: p.role,
              status: p.status,
              isYou: p.role.toLowerCase() === role.toLowerCase(),
              availableForHandoff:
                p.status === 'waiting' && p.role.toLowerCase() !== role.toLowerCase(),
            })),
          },
          context: {
            originMessage: contextWindow.originMessage
              ? {
                  id: contextWindow.originMessage._id,
                  senderRole: contextWindow.originMessage.senderRole,
                  content: contextWindow.originMessage.content,
                  classification: contextWindow.originMessage.classification,
                }
              : null,
            allMessages: contextWindow.contextMessages.map((m) => ({
              id: m._id,
              senderRole: m.senderRole,
              content: m.content,
              type: m.type,
              targetRole: m.targetRole,
              classification: m.classification,
            })),
            currentClassification: contextWindow.classification,
          },
          instructions: {
            taskStartedCommand: needsClassification
              ? `chatroom task-started ${chatroomId} --role=${role} --classification=<question|new_feature|follow_up>`
              : null,
            taskCompleteCommand: `chatroom handoff ${chatroomId} --role=${role} --message="<summary>" --next-role=<target>`,
            availableHandoffRoles: rolePromptInfo.availableHandoffRoles,
            terminationRole: 'user',
            classification: rolePromptInfo.currentClassification,
            handoffRestriction: rolePromptInfo.restrictionReason,
            classificationCommands,
            contextCommands,
          },
        };

        console.log(JSON.stringify(jsonOutput, null, 2));

        process.exit(0);
      } else {
        // No pending tasks yet, schedule next poll
        pollTimeout = setTimeout(poll, currentPollInterval);
      }

      // Reset error counter and poll interval on success
      consecutiveErrors = 0;
      currentPollInterval = WAIT_POLL_INTERVAL_MS;
    } catch (error) {
      consecutiveErrors++;
      const err = error as Error;

      // Implement exponential backoff with max limit
      const maxInterval = 30000; // Max 30 seconds
      currentPollInterval = Math.min(
        WAIT_POLL_INTERVAL_MS * Math.pow(2, Math.min(consecutiveErrors - 1, 10)),
        maxInterval
      );

      if (consecutiveErrors === MAX_SILENT_ERRORS) {
        console.warn(`⚠️  Connection issues, retrying with backoff... (${err.message})`);
        console.warn(`   Next retry in ${currentPollInterval / 1000}s`);
      } else if (consecutiveErrors > MAX_SILENT_ERRORS && consecutiveErrors % 10 === 0) {
        console.warn(`⚠️  Still experiencing issues after ${consecutiveErrors} attempts`);
        console.warn(`   Retry interval: ${currentPollInterval / 1000}s`);
      }

      // Schedule next poll with backoff
      pollTimeout = setTimeout(poll, currentPollInterval);
    }
  };

  // Start polling
  poll();

  // Handle interrupt signals
  const handleSignal = (signal: string) => {
    if (pollTimeout) clearTimeout(pollTimeout);
    clearTimeout(timeoutHandle);
    console.log(`\n⚠️  ${signal} received - process terminated by host`);
    console.log(`   The wait session ended before timing out naturally.`);
    console.log(`   To resume waiting, run:`);
    console.log(`   chatroom wait-for-task ${chatroomId} --role=${role}`);
    process.exit(0);
  };

  // SIGINT: Ctrl+C or interrupt signal
  process.on('SIGINT', () => handleSignal('SIGINT'));

  // SIGTERM: Graceful termination (e.g., container shutdown, AI agent timeout)
  process.on('SIGTERM', () => handleSignal('SIGTERM'));

  // SIGHUP: Hang up signal (terminal closed)
  process.on('SIGHUP', () => handleSignal('SIGHUP'));
}
