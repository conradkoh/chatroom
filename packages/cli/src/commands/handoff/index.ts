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

import { getNextTaskCommand } from '@workspace/backend/prompts/cli/get-next-task/command.js';
import { handoffCommand } from '@workspace/backend/prompts/cli/handoff/command.js';
import { getCliEnvPrefix } from '@workspace/backend/prompts/utils/env.js';
import { ConvexError } from 'convex/values';

import type { HandoffDeps } from './deps.js';
import { api } from '../../api.js';
import type { Id } from '../../api.js';
import { getSessionId, getOtherSessionUrls } from '../../infrastructure/auth/storage.js';
import { getConvexClient, getConvexUrl } from '../../infrastructure/convex/client.js';
import {
  formatError,
  formatAuthError,
  formatChatroomIdError,
} from '../../utils/error-formatting.js';

// ─── Re-exports for testing ────────────────────────────────────────────────

export type { HandoffDeps } from './deps.js';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface HandoffOptions {
  role: string;
  message: string;
  nextRole: string;
  attachedArtifactIds?: string[];
}

// ─── Default Deps Factory ──────────────────────────────────────────────────

async function createDefaultDeps(): Promise<HandoffDeps> {
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

// ─── Entry Point ───────────────────────────────────────────────────────────

export async function handoff(
  chatroomId: string,
  options: HandoffOptions,
  deps?: HandoffDeps
): Promise<void> {
  const d = deps ?? (await createDefaultDeps());
  const { role, message, nextRole, attachedArtifactIds = [] } = options;

  // Get session ID for authentication
  const sessionId = d.session.getSessionId();
  if (!sessionId) {
    const otherUrls = d.session.getOtherSessionUrls();
    const currentUrl = d.session.getConvexUrl();
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
      const areValid = await d.backend.query(api.artifacts.validateArtifactIds, {
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

  let result;
  try {
    result = await d.backend.mutation(api.messages.handoff, {
      sessionId,
      chatroomId: chatroomId as Id<'chatroom_rooms'>,
      senderRole: role,
      content: message,
      targetRole: nextRole,
      ...(attachedArtifactIds.length > 0 && {
        attachedArtifactIds: attachedArtifactIds as Id<'chatroom_artifacts'>[],
      }),
    });
  } catch (error) {
    console.error(`\n❌ ERROR: Handoff failed`);

    if (error instanceof ConvexError) {
      const errorData = error.data as { code?: string; message?: string };
      console.error(`\n${errorData.message || 'An unexpected error occurred'}`);

      if (process.env.CHATROOM_DEBUG === 'true') {
        console.error('\n🔍 Debug Info:');
        console.error(JSON.stringify(errorData, null, 2));
      }

      const convexUrl = d.session.getConvexUrl();
      if (errorData.code === 'AUTH_FAILED') {
        console.error('\n💡 Try authenticating again:');
        console.error(`   chatroom auth ${convexUrl}`);
      } else if (errorData.code === 'INVALID_ROLE') {
        console.error('\n💡 Check your team configuration and use a valid role');
      }
    } else {
      console.error(`\n${error instanceof Error ? error.message : String(error)}`);

      if (process.env.CHATROOM_DEBUG === 'true') {
        console.error('\n🔍 Debug Info:');
        console.error(error);
      }
    }

    console.error('\n📚 Need help? Check the docs or run:');
    console.error(`   chatroom handoff --help`);
    process.exit(1);
    return; // Unreachable in production, but ensures `result` is assigned for type safety
  }

  // Check for handoff restriction errors
  if (!result.success && result.error) {
    const convexUrl = d.session.getConvexUrl();
    const cliEnvPrefix = getCliEnvPrefix(convexUrl);
    console.error(`\n❌ ERROR: ${result.error.message}`);

    // For invalid target role, show available targets and workflow
    if (result.error.code === 'INVALID_TARGET_ROLE' && result.error.suggestedTargets) {
      console.error(`\n📋 Available handoff targets for this team:`);
      for (const target of result.error.suggestedTargets) {
        console.error(`   • ${target}`);
      }
      console.error(
        `\n💡 Check your team's workflow in the system prompt for valid handoff paths.`
      );
    } else if (result.error.suggestedTarget) {
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
  if (attachedArtifactIds.length > 0) {
    console.log(`📎 Attached artifacts: ${attachedArtifactIds.length}`);
    attachedArtifactIds.forEach((id) => {
      console.log(`   • ${id}`);
    });
  }

  const convexUrl = d.session.getConvexUrl();
  const cliEnvPrefix = getCliEnvPrefix(convexUrl);
  console.log(`\n⏳ Next → \`${getNextTaskCommand({ chatroomId, role, cliEnvPrefix })}\``);
}
