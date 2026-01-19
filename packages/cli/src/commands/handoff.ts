/**
 * Complete a task and hand off to the next role
 *
 * This command uses the atomic handoff mutation which performs all of
 * these operations in a single transaction:
 * 1. Validates the handoff is allowed (classification rules)
 * 2. Completes all in_progress tasks in the chatroom
 * 3. Sends the handoff message
 * 4. Creates a task for the target agent (if not handing to user)
 * 5. Updates the sender's participant status to waiting
 * 6. Promotes the next queued task to pending
 */

import { api } from '../api.js';
import type { Id } from '../api.js';
import { getSessionId } from '../infrastructure/auth/storage.js';
import { getConvexClient } from '../infrastructure/convex/client.js';

interface HandoffOptions {
  role: string;
  message: string;
  nextRole: string;
}

export async function handoff(chatroomId: string, options: HandoffOptions): Promise<void> {
  const client = await getConvexClient();
  const { role, message, nextRole } = options;

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

  // Use atomic handoff mutation - performs all operations in one transaction:
  // - Validates handoff is allowed (classification rules for user handoff)
  // - Completes all in_progress tasks
  // - Sends the handoff message
  // - Creates a task for target agent (if not user)
  // - Updates sender's participant status to waiting
  // - Promotes next queued task to pending
  //
  // Note: We use sendHandoff here for backward compatibility with deployed backend.
  // Once backend is deployed with the new 'handoff' mutation, this can be changed to api.messages.handoff
  const result = (await client.mutation(api.messages.sendHandoff, {
    sessionId,
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
    senderRole: role,
    content: message,
    targetRole: nextRole,
  })) as {
    success: boolean;
    error?: {
      code: string;
      message: string;
      suggestedTarget?: string;
    } | null;
    messageId: string | null;
    completedTaskIds: string[];
    newTaskId: string | null;
    promotedTaskId: string | null;
  };

  // Check for handoff restriction errors
  if (!result.success && result.error) {
    console.error(`\n❌ ERROR: ${result.error.message}`);
    if (result.error.suggestedTarget) {
      console.error(`\n💡 Try this instead:`);
      console.error('```');
      console.error(
        `chatroom handoff ${chatroomId} --role=${role} --message="<summary>" --next-role=${result.error.suggestedTarget}`
      );
      console.error('```');
    }
    process.exit(1);
  }

  console.log(`✅ Task completed and handed off to ${nextRole}`);
  console.log(`📋 Summary: ${message.substring(0, 100)}${message.length > 100 ? '...' : ''}`);

  // Check if handing off to user (workflow completion)
  if (nextRole.toLowerCase() === 'user') {
    console.log(`\n🎉 Workflow complete! Control returned to user.`);
  }

  // Remind agent to run wait-for-task manually
  console.log(`\n⏳ Now run wait-for-task to wait for your next assignment:`);
  console.log(`   chatroom wait-for-task ${chatroomId} --role=${role} --session=1`);
}
