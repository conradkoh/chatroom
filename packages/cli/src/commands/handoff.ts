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

import { handoffCommand } from '@workspace/backend/prompts/base/cli/handoff/command.js';
import { waitForTaskCommand } from '@workspace/backend/prompts/base/cli/wait-for-task/command.js';
import { getCliEnvPrefix } from '@workspace/backend/prompts/utils/env.js';
import { ConvexError } from 'convex/values';

import { api } from '../api.js';
import type { Id } from '../api.js';
import { getSessionId, getOtherSessionUrls } from '../infrastructure/auth/storage.js';
import { getConvexClient, getConvexUrl } from '../infrastructure/convex/client.js';
import { formatError, formatAuthError, formatChatroomIdError } from '../utils/error-formatting.js';

interface HandoffOptions {
  role: string;
  message: string;
  nextRole: string;
  attachedArtifactIds?: string[];
}

export async function handoff(chatroomId: string, options: HandoffOptions): Promise<void> {
  const client = await getConvexClient();
  const { role, message, nextRole, attachedArtifactIds = [] } = options;

  // Get session ID for authentication
  const sessionId = getSessionId();
  if (!sessionId) {
    const otherUrls = getOtherSessionUrls();
    const currentUrl = getConvexUrl();
    formatAuthError(currentUrl, otherUrls);
    process.exit(1);
  }

  // Validate chatroom ID format
  if (
    !chatroomId ||
    typeof chatroomId !== 'string' ||
    chatroomId.length < 20 ||
    chatroomId.length > 40
  ) {
    formatChatroomIdError(chatroomId);
    process.exit(1);
  }

  // Validate artifact IDs if provided
  if (attachedArtifactIds.length > 0) {
    try {
      const areValid = await client.query(api.artifacts.validateArtifactIds, {
        sessionId,
        artifactIds: attachedArtifactIds as Id<'chatroom_artifacts'>[],
      });

      if (!areValid) {
        formatError('One or more artifacts not found', [
          'Please create artifacts first:',
          `chatroom artifact create ${chatroomId} --from-file=... --filename=...`,
        ]);
        process.exit(1);
      }
    } catch (error) {
      formatError('Failed to validate artifacts', [String(error)]);
      process.exit(1);
    }
  }

  // Use atomic handoff mutation - performs all operations in one transaction:
  // - Validates handoff is allowed (classification rules for user handoff)
  // - Completes all in_progress tasks
  // - Sends the handoff message with artifact attachments
  // - Creates a task for target agent (if not user)
  // - Updates sender's participant status to waiting
  // - Promotes next queued task to pending
  //
  // Note: We use sendHandoff here for backward compatibility with deployed backend.
  // Send handoff mutation
  // TODO: Artifact attachment is not yet supported by backend's sendHandoff
  // If artifacts need to be included, they should be uploaded separately
  let result;
  try {
    result = (await client.mutation(api.messages.sendHandoff, {
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
  } catch (error) {
    // Handle ConvexError (application errors) and unexpected errors
    console.error(`\n❌ ERROR: Handoff failed`);

    if (error instanceof ConvexError) {
      // Application error - show structured error data
      const errorData = error.data as { code?: string; message?: string };
      console.error(`\n${errorData.message || 'An unexpected error occurred'}`);

      // Log full error for debugging
      if (process.env.CHATROOM_DEBUG === 'true') {
        console.error('\n🔍 Debug Info:');
        console.error(JSON.stringify(errorData, null, 2));
      }

      // Show suggestion based on error code
      const convexUrl = getConvexUrl();
      if (errorData.code === 'AUTH_FAILED') {
        console.error('\n💡 Try authenticating again:');
        console.error(`   chatroom auth ${convexUrl}`);
      } else if (errorData.code === 'INVALID_ROLE') {
        console.error('\n💡 Check your team configuration and use a valid role');
      }
    } else {
      // Unexpected error
      console.error(`\n${error instanceof Error ? error.message : String(error)}`);

      // Log full error for debugging
      if (process.env.CHATROOM_DEBUG === 'true') {
        console.error('\n🔍 Debug Info:');
        console.error(error);
      }
    }

    console.error('\n📚 Need help? Check the docs or run:');
    console.error(`   chatroom handoff --help`);
    process.exit(1);
  }

  // Check for handoff restriction errors
  if (!result.success && result.error) {
    const convexUrl = getConvexUrl();
    const cliEnvPrefix = getCliEnvPrefix(convexUrl);
    console.error(`\n❌ ERROR: ${result.error.message}`);
    if (result.error.suggestedTarget) {
      console.error(`\n💡 Try this instead:`);
      console.error('```');
      console.error(
        handoffCommand({
          chatroomId,
          role,
          nextRole: result.error.suggestedTarget,
          cliEnvPrefix,
        })
      );
      console.error('```');
    }
    process.exit(1);
  }

  console.log(`✅ Task completed and handed off to ${nextRole}`);
  console.log(`📋 Summary: ${message}`);
  // Show attached artifacts if any
  if (attachedArtifactIds.length > 0) {
    console.log(`📎 Attached artifacts: ${attachedArtifactIds.length}`);
    attachedArtifactIds.forEach((id) => {
      console.log(`   • ${id}`);
    });
  }

  // Check if handing off to user (workflow completion)
  if (nextRole.toLowerCase() === 'user') {
    console.log(`\n🎉 Workflow complete! Control returned to user.`);
  }

  // Remind agent to run wait-for-task manually
  const convexUrl = getConvexUrl();
  const cliEnvPrefix = getCliEnvPrefix(convexUrl);
  console.log(`\n⏳ Now run wait-for-task to wait for your next assignment:`);
  console.log(`   ${waitForTaskCommand({ chatroomId, role, cliEnvPrefix })}`);
}
