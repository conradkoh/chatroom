/**
 * Complete a task and hand off to the next role
 */

import { waitForMessage } from './wait-for-message.js';
import { api } from '../api.js';
import type { Id, AllowedHandoffRoles } from '../api.js';
import { getSessionId } from '../infrastructure/auth/storage.js';
import { getConvexClient } from '../infrastructure/convex/client.js';

interface TaskCompleteOptions {
  role: string;
  message: string;
  nextRole: string;
  noWait?: boolean;
}

export async function taskComplete(
  chatroomId: string,
  options: TaskCompleteOptions
): Promise<void> {
  const client = await getConvexClient();
  const { role, message, nextRole, noWait } = options;

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

  // Check if handoff to user is allowed based on classification
  if (nextRole.toLowerCase() === 'user') {
    const allowedRoles = (await client.query(api.messages.getAllowedHandoffRoles, {
      sessionId,
      chatroomId: chatroomId as Id<'chatroom_rooms'>,
      role,
    })) as AllowedHandoffRoles;

    if (!allowedRoles.canHandoffToUser) {
      console.error(`\n❌ Cannot hand off directly to user`);
      console.error(`   Reason: ${allowedRoles.restrictionReason}`);
      console.error(`\n📋 Current classification: ${allowedRoles.currentClassification}`);
      console.error(`\n💡 Available handoff roles: ${allowedRoles.availableRoles.join(', ')}`);
      console.error(`\n   Please hand off to: reviewer`);
      console.error(
        `   Example: chatroom task-complete ${chatroomId} --role=${role} --message="<summary>" --next-role=reviewer`
      );
      process.exit(1);
    }
  }

  // Complete the current in_progress task and promote queued tasks
  await client.mutation(api.tasks.completeTask, {
    sessionId,
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
    role,
  });

  // Send handoff message
  await client.mutation(api.messages.send, {
    sessionId,
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
    senderRole: role,
    content: message,
    targetRole: nextRole,
    type: 'handoff',
  });

  // Update participant status to waiting
  await client.mutation(api.participants.updateStatus, {
    sessionId,
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
    role,
    status: 'waiting',
  });

  console.log(`✅ Task completed and handed off to ${nextRole}`);
  console.log(`📋 Summary: ${message.substring(0, 100)}${message.length > 100 ? '...' : ''}`);

  // Check if handing off to user (workflow completion)
  if (nextRole.toLowerCase() === 'user') {
    console.log(`\n🎉 Workflow complete! Control returned to user.`);
    if (!noWait) {
      console.log(`\n⏳ Waiting for next assignment...`);
      await waitForMessage(chatroomId, { role, silent: true });
    }
    return;
  }

  // Auto-wait for next message unless --no-wait is specified
  if (!noWait) {
    console.log(`\n⏳ Waiting for next assignment...`);
    await waitForMessage(chatroomId, { role, silent: true });
  }
}
