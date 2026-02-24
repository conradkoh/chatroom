/**
 * Report progress on the current task without completing it
 *
 * This command allows agents to send status updates during long-running operations.
 * Progress messages are visible in the webapp but do not trigger handoffs or task changes.
 */

import { ConvexError } from 'convex/values';

import type { ReportProgressDeps } from './deps.js';
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

export type { ReportProgressDeps } from './deps.js';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface ReportProgressOptions {
  role: string;
  message: string;
}

// ─── Default Deps Factory ──────────────────────────────────────────────────

async function createDefaultDeps(): Promise<ReportProgressDeps> {
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

export async function reportProgress(
  chatroomId: string,
  options: ReportProgressOptions,
  deps?: ReportProgressDeps
): Promise<void> {
  const d = deps ?? (await createDefaultDeps());
  const { role, message } = options;

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

  // Validate message is not empty
  if (!message || message.trim().length === 0) {
    formatError('Progress message cannot be empty', [
      'Provide a message via stdin',
      "Example: chatroom report-progress <id> --role=builder << 'EOF'",
      'Your message here',
      'EOF',
    ]);
    process.exit(1);
  }

  // Call the reportProgress mutation
  try {
    const result = await d.backend.mutation(api.messages.reportProgress, {
      sessionId,
      chatroomId: chatroomId as Id<'chatroom_rooms'>,
      senderRole: role,
      content: message,
    });

    if (result.success) {
      console.log(`✅ Progress reported`);
      console.log(`📋 ${message}`);
    }
  } catch (error) {
    // Handle ConvexError (application errors) and unexpected errors
    console.error(`\n❌ ERROR: Failed to report progress`);

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
      const convexUrl = d.session.getConvexUrl();
      if (errorData.code === 'AUTH_FAILED') {
        console.error('\n💡 Try authenticating again:');
        console.error(`   chatroom auth ${convexUrl}`);
      } else if (errorData.code === 'INVALID_ROLE') {
        console.error('\n💡 Check your team configuration and use a valid role');
      } else if (errorData.code === 'INVALID_CONTENT') {
        console.error('\n💡 Provide a non-empty message');
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
    console.error(`   chatroom report-progress --help`);
    process.exit(1);
    return;
  }
}
