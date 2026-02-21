/**
 * Complete a task without handing off to another role
 *
 * This command completes the current in_progress task and optionally
 * promotes the next queued task to pending status.
 */

import { waitForTaskCommand } from '@workspace/backend/prompts/base/cli/wait-for-task/command.js';
import { getCliEnvPrefix } from '@workspace/backend/prompts/utils/env.js';
import { ConvexError } from 'convex/values';

import type { TaskCompleteDeps } from './deps.js';
import { api } from '../../api.js';
import type { Id } from '../../api.js';
import { getSessionId, getOtherSessionUrls } from '../../infrastructure/auth/storage.js';
import { getConvexClient, getConvexUrl } from '../../infrastructure/convex/client.js';
import { sendLifecycleHeartbeat } from '../../infrastructure/lifecycle-heartbeat.js';
import {
  formatError,
  formatAuthError,
  formatChatroomIdError,
} from '../../utils/error-formatting.js';

// ─── Re-exports for testing ────────────────────────────────────────────────

export type { TaskCompleteDeps } from './deps.js';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface TaskCompleteOptions {
  role: string;
}

// ─── Default Deps Factory ──────────────────────────────────────────────────

async function createDefaultDeps(): Promise<TaskCompleteDeps> {
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

export async function taskComplete(
  chatroomId: string,
  options: TaskCompleteOptions,
  deps?: TaskCompleteDeps
): Promise<void> {
  const d = deps ?? (await createDefaultDeps());
  const { role } = options;

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

  sendLifecycleHeartbeat(d.backend, { sessionId, chatroomId, role });

  // Complete the task using the existing completeTask mutation
  let result;
  try {
    result = await d.backend.mutation(api.tasks.completeTask, {
      sessionId,
      chatroomId: chatroomId as Id<'chatroom_rooms'>,
      role,
    });
  } catch (error) {
    console.error(`\n❌ ERROR: Task completion failed`);

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
      }
    } else {
      console.error(`\n${error instanceof Error ? error.message : String(error)}`);

      if (process.env.CHATROOM_DEBUG === 'true') {
        console.error('\n🔍 Debug Info:');
        console.error(error);
      }
    }

    console.error('\n📚 Need help? Check the docs or run:');
    console.error(`   chatroom task-complete --help`);
    process.exit(1);
    return;
  }

  if (!result.completed) {
    formatError('No task to complete', [
      'Make sure you have an in_progress task before completing.',
      'Run `chatroom wait-for-task` to receive and start a task first.',
    ]);
    process.exit(1);
  }

  console.log(`✅ Task completed successfully`);
  console.log(`   Tasks completed: ${result.completedCount}`);

  if (result.promoted) {
    console.log(`   Promoted next task: ${result.promoted}`);
  }

  // Remind agent to run wait-for-task
  const convexUrl = d.session.getConvexUrl();
  const cliEnvPrefix = getCliEnvPrefix(convexUrl);
  console.log(`\n⏳ Now run wait-for-task to wait for your next assignment:`);
  console.log(`   ${waitForTaskCommand({ chatroomId, role, cliEnvPrefix })}`);
}
