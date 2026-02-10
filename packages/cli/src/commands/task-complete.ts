/**
 * Complete a task without handing off to another role
 *
 * This command completes the current in_progress task and optionally
 * promotes the next queued task to pending status.
 */

import { waitForTaskCommand } from '@workspace/backend/prompts/base/cli/wait-for-task/command.js';
import { getCliEnvPrefix } from '@workspace/backend/prompts/utils/env.js';
import { ConvexError } from 'convex/values';

import { api } from '../api.js';
import type { Id } from '../api.js';
import { getSessionId, getOtherSessionUrls } from '../infrastructure/auth/storage.js';
import { getConvexClient, getConvexUrl } from '../infrastructure/convex/client.js';
import { formatError, formatAuthError, formatChatroomIdError } from '../utils/error-formatting.js';

interface TaskCompleteOptions {
  role: string;
}

export async function taskComplete(
  chatroomId: string,
  options: TaskCompleteOptions
): Promise<void> {
  const client = await getConvexClient();
  const { role } = options;

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

  // Complete the task using the existing completeTask mutation
  let result;
  try {
    result = (await client.mutation(api.tasks.completeTask, {
      sessionId,
      chatroomId: chatroomId as Id<'chatroom_rooms'>,
      role,
    })) as {
      completed: boolean;
      completedCount: number;
      promoted: string | null;
      pendingReview: string[];
    };
  } catch (error) {
    console.error(`\n❌ ERROR: Task completion failed`);

    if (error instanceof ConvexError) {
      const errorData = error.data as { code?: string; message?: string };
      console.error(`\n${errorData.message || 'An unexpected error occurred'}`);

      if (process.env.CHATROOM_DEBUG === 'true') {
        console.error('\n🔍 Debug Info:');
        console.error(JSON.stringify(errorData, null, 2));
      }

      const convexUrl = getConvexUrl();
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
  const convexUrl = getConvexUrl();
  const cliEnvPrefix = getCliEnvPrefix(convexUrl);
  console.log(`\n⏳ Now run wait-for-task to wait for your next assignment:`);
  console.log(`   ${waitForTaskCommand({ chatroomId, role, cliEnvPrefix })}`);
}
