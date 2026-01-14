/**
 * Complete a task and hand off to the next role
 */

import { waitForMessage } from './wait-for-message.js';
import { api } from '../api.js';
import type { Id } from '../api.js';
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

  // Send handoff message
  await client.mutation(api.messages.send, {
    chatroomId: chatroomId as Id<'chatrooms'>,
    senderRole: role,
    content: message,
    targetRole: nextRole,
    type: 'handoff',
  });

  // Update participant status to waiting
  await client.mutation(api.participants.updateStatus, {
    chatroomId: chatroomId as Id<'chatrooms'>,
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
