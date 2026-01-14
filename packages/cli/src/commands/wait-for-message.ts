/**
 * Wait for messages in a chatroom
 */

import { api, type Id, type Chatroom, type Message, type Participant } from '../api.js';
import { WAIT_POLL_INTERVAL_MS, MAX_SILENT_ERRORS } from '../config.js';
import { getSessionId } from '../infrastructure/auth/storage.js';
import { getConvexClient } from '../infrastructure/convex/client.js';

interface WaitForMessageOptions {
  role: string;
  timeout?: number;
  silent?: boolean;
}

export async function waitForMessage(
  chatroomId: string,
  options: WaitForMessageOptions
): Promise<void> {
  const client = await getConvexClient();
  const { role, timeout, silent } = options;

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
    chatroomId: chatroomId as Id<'chatrooms'>,
  })) as Chatroom | null;

  if (!chatroom) {
    console.error(`❌ Chatroom ${chatroomId} not found or access denied`);
    process.exit(1);
  }

  // Join the chatroom
  await client.mutation(api.participants.join, {
    sessionId,
    chatroomId: chatroomId as Id<'chatrooms'>,
    role,
  });

  if (!silent) {
    console.log(`✅ Joined chatroom as "${role}"`);
  }
  console.log(`⏳ Waiting for messages...`);
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`After completing this task, run:\n`);
  console.log(`\`\`\`bash`);
  console.log(`chatroom wait-for-message ${chatroomId} --role=${role}`);
  console.log(`\`\`\``);
  console.log(`${'─'.repeat(50)}`);
  console.log(
    `💡 NOTE: Remember to always wait for messages after your task is complete to prepare for the next task.`
  );
  console.log(`${'─'.repeat(50)}\n`);

  // Get the current latest message ID to know where to start listening
  // Use pagination to avoid loading entire history
  const existingMessages = (await client.query(api.messages.list, {
    sessionId,
    chatroomId: chatroomId as Id<'chatrooms'>,
    limit: 1,
  })) as Message[];

  const afterMessageId =
    existingMessages.length > 0 ? existingMessages[existingMessages.length - 1]!._id : undefined;

  // Track errors for better debugging with exponential backoff
  let consecutiveErrors = 0;
  let currentPollInterval = WAIT_POLL_INTERVAL_MS;
  let pollTimeout: ReturnType<typeof setTimeout>;

  // Set up optional timeout
  const timeoutHandle = timeout
    ? setTimeout(() => {
        if (pollTimeout) clearTimeout(pollTimeout);
        console.log(`\n⏱️  Timeout after ${timeout / 1000}s waiting for messages`);
        process.exit(1);
      }, timeout)
    : null;

  // Polling function with exponential backoff
  const poll = async () => {
    try {
      const message = (await client.query(api.messages.getLatestForRole, {
        sessionId,
        chatroomId: chatroomId as Id<'chatrooms'>,
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
        if (timeoutHandle) clearTimeout(timeoutHandle);

        // Update participant status to active
        await client.mutation(api.participants.updateStatus, {
          sessionId,
          chatroomId: chatroomId as Id<'chatrooms'>,
          role,
          status: 'active',
        });

        // Get current chatroom state
        const chatroomData = (await client.query(api.chatrooms.get, {
          sessionId,
          chatroomId: chatroomId as Id<'chatrooms'>,
        })) as Chatroom | null;

        const participants = (await client.query(api.participants.list, {
          sessionId,
          chatroomId: chatroomId as Id<'chatrooms'>,
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
        console.log(`${'─'.repeat(50)}`);
        console.log(`After completing this task, run:\n`);
        console.log(`\`\`\`bash`);
        console.log(`chatroom wait-for-message ${chatroomId} --role=${role}`);
        console.log(`\`\`\``);
        console.log(`${'─'.repeat(50)}`);
        console.log(
          `💡 NOTE: Remember to always wait for messages after your task is complete to prepare for the next task.`
        );
        console.log(`${'─'.repeat(50)}`);

        // Output JSON for parsing
        console.log(`${'─'.repeat(50)}`);
        console.log(`📊 MESSAGE DATA (JSON)`);
        console.log(`${'─'.repeat(50)}`);

        const availableHandoffRoles = participants
          .filter((p) => p.status === 'waiting' && p.role.toLowerCase() !== role.toLowerCase())
          .map((p) => p.role);

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
          instructions: {
            taskCompleteCommand: `chatroom task-complete ${chatroomId} --role=${role} --message="<summary>" --next-role=<target>`,
            availableHandoffRoles: [...availableHandoffRoles, 'user'],
            terminationRole: 'user',
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
    if (timeoutHandle) clearTimeout(timeoutHandle);
    console.log(`\n⚠️  Interrupted`);
    process.exit(0);
  });
}
