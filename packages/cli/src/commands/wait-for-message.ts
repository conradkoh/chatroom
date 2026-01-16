/**
 * Wait for messages in a chatroom
 */

import {
  api,
  type Id,
  type Chatroom,
  type Message,
  type Participant,
  type ContextWindow,
  type RolePromptResponse,
} from '../api.js';
import { WAIT_POLL_INTERVAL_MS, MAX_SILENT_ERRORS } from '../config.js';
import { getSessionId } from '../infrastructure/auth/storage.js';
import { getConvexClient } from '../infrastructure/convex/client.js';

interface WaitForMessageOptions {
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
 * Print the wait-for-message reminder - short but forceful.
 */
function printWaitReminder(chatroomId: string, role: string): void {
  console.log(`${'─'.repeat(50)}`);
  console.log(
    `⚠️  ALWAYS run \`wait-for-message\` after task-complete/send. If it times out, run it again immediately.`
  );
  console.log(`    chatroom wait-for-message ${chatroomId} --role=${role}`);
  console.log(`${'─'.repeat(50)}`);
}

export async function waitForMessage(
  chatroomId: string,
  options: WaitForMessageOptions
): Promise<void> {
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
  // If no timeout specified, default to 2 minutes
  const effectiveTimeout = timeout || 2 * 60 * 1000;
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
  const durationDisplay = duration || formatDuration(effectiveTimeout);
  console.log(`⏳ Waiting for messages (duration: ${durationDisplay})...`);
  console.log('');
  printWaitReminder(chatroomId, role);
  console.log('');

  // Get the current latest message ID to know where to start listening
  // Use pagination to avoid loading entire history
  const existingMessages = (await client.query(api.messages.list, {
    sessionId,
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
    limit: 1,
  })) as Message[];

  const afterMessageId =
    existingMessages.length > 0 ? existingMessages[existingMessages.length - 1]!._id : undefined;

  // Track errors for better debugging with exponential backoff
  let consecutiveErrors = 0;
  let currentPollInterval = WAIT_POLL_INTERVAL_MS;
  let pollTimeout: ReturnType<typeof setTimeout>;

  // Set up timeout - now always has a default value
  const timeoutHandle = setTimeout(() => {
    if (pollTimeout) clearTimeout(pollTimeout);
    const durationDisplay = duration || formatDuration(effectiveTimeout);
    const command = `chatroom wait-for-message ${chatroomId} --role=${role}${duration ? ` --duration="${duration}"` : ''}`;
    console.log(`\n✅ WAIT SESSION COMPLETE AFTER ${durationDisplay} of waiting`);
    console.log(`Please continue listening by running \`${command}\``);
    process.exit(0); // Exit with 0 since this is expected behavior
  }, effectiveTimeout);

  // Polling function with exponential backoff
  const poll = async () => {
    try {
      const message = (await client.query(api.messages.getLatestForRole, {
        sessionId,
        chatroomId: chatroomId as Id<'chatroom_rooms'>,
        role,
        afterMessageId,
      })) as Message | null;

      if (message) {
        // CRITICAL: Claim the message atomically to handle race conditions
        // This mutation uses Convex's ACID guarantees to ensure only one agent
        // can successfully claim a broadcast message
        const claimed = await client.mutation(api.messages.claimMessage, {
          sessionId,
          messageId: message._id,
          role,
        });

        if (!claimed) {
          // RACE CONDITION DETECTED: Another agent successfully claimed this message
          // This is expected behavior when multiple agents are polling for broadcasts
          console.log(`🔄 Message already claimed by another agent, continuing to wait...`);

          // Schedule next poll with current interval and return early
          pollTimeout = setTimeout(poll, currentPollInterval);
          return;
        }

        // SUCCESS: This agent has exclusive claim on the message
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

        // Handle interrupt
        if (message.type === 'interrupt') {
          console.log(`\n${'═'.repeat(50)}`);
          console.log(`⚠️  INTERRUPT RECEIVED`);
          console.log(`${'═'.repeat(50)}`);
          console.log(`Message: ${message.content}`);
          console.log(`\nAll agents have been reset to idle state.`);
          console.log(`Rejoin the chatroom to continue participating.`);
          process.exit(0);
        }

        // Print message details
        console.log(`\n${'═'.repeat(50)}`);
        console.log(`📨 MESSAGE RECEIVED`);
        console.log(`${'═'.repeat(50)}`);
        console.log(`From: ${message.senderRole}`);
        console.log(`Type: ${message.type}`);
        if (message.targetRole) {
          console.log(`To: ${message.targetRole}`);
        }
        console.log(`\n📄 Content:\n${message.content}`);

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

        // Print next steps
        console.log(`\n${'─'.repeat(50)}`);
        console.log(`📝 NEXT STEPS`);
        console.log(`${'─'.repeat(50)}`);
        console.log(`When your task is complete, run:\n`);
        console.log(`  chatroom task-complete ${chatroomId} \\`);
        console.log(`    --role=${role} \\`);
        console.log(`    --message="<summary of what you accomplished>" \\`);
        console.log(`    --next-role=<target>\n`);

        // Print reminder
        printWaitReminder(chatroomId, role);

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

        // Output role-specific prompt/guidance
        console.log(`${'─'.repeat(50)}`);
        console.log(`📋 ROLE GUIDANCE`);
        console.log(`${'─'.repeat(50)}`);
        console.log(rolePromptInfo.prompt);

        // Output JSON for parsing
        console.log(`\n${'─'.repeat(50)}`);
        console.log(`📊 MESSAGE DATA (JSON)`);
        console.log(`${'─'.repeat(50)}`);

        const jsonOutput = {
          message: {
            id: message._id,
            senderRole: message.senderRole,
            content: message.content,
            type: message.type,
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
            taskStartedCommand:
              rolePromptInfo.currentClassification === null
                ? `chatroom task-started ${chatroomId} --role=${role} --classification=<question|new_feature|follow_up>`
                : null,
            taskCompleteCommand: `chatroom task-complete ${chatroomId} --role=${role} --message="<summary>" --next-role=<target>`,
            availableHandoffRoles: rolePromptInfo.availableHandoffRoles,
            terminationRole: 'user',
            classification: rolePromptInfo.currentClassification,
            handoffRestriction: rolePromptInfo.restrictionReason,
          },
        };

        console.log(JSON.stringify(jsonOutput, null, 2));

        process.exit(0);
      } else {
        // No message yet, schedule next poll
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

  // Handle interrupt
  process.on('SIGINT', () => {
    if (pollTimeout) clearTimeout(pollTimeout);
    clearTimeout(timeoutHandle);
    console.log(`\n⚠️  Interrupted`);
    process.exit(0);
  });
}
