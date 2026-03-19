/**
 * Read a task and mark it as in_progress
 *
 * This command is the primary way to transition a task from acknowledged →in_progress.
 * It calls the backend readTask mutation which atomically:
 * 1. Validates the task exists and is assigned to the caller's role
 * 2. Transitions the task to in_progress
 * 3. Returns the task content
 */

import type { TaskReadDeps } from './deps.js';
import { api } from '../../../api.js';
import type { Id } from '../../../api.js';
import { getSessionId, getOtherSessionUrls } from '../../../infrastructure/auth/storage.js';
import { getConvexClient, getConvexUrl } from '../../../infrastructure/convex/client.js';

// ─── Re-exports for testing ───────────────────────── ──────────────────────

export type { TaskReadDeps } from './deps.js';

// ─── Types ───────────────────────────────────────────── ───────────────────

export interface TaskReadOptions {
  role: string;
  taskId: string;
}

// ─── Default Deps Factory ───────────────────────────────────────────────────

async function createDefaultDeps(): Promise<TaskReadDeps> {
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

// ─── Entry Point ───────────────────────────────────────── ──────────────────

export async function taskRead(
  chatroomId: string,
  options: TaskReadOptions,
  deps?: TaskReadDeps
): Promise<void> {
  const d = deps ?? (await createDefaultDeps());
  const { role, taskId } = options;

  // Get Convex URL for error messages
  const convexUrl = d.session.getConvexUrl();

  // Get session ID for authentication
  const sessionId = d.session.getSessionId();
  if (!sessionId) {
    const otherUrls = d.session.getOtherSessionUrls();

    console.error(`❌ Not authenticated for: ${convexUrl}`);

    if (otherUrls.length > 0) {
      console.error(`\n💡 You have sessions for other environments:`);
      for (const url of otherUrls) {
        console.error(`   • ${url}`);
      }
      console.error(`\n   To use a different environment, set CHATROOM_CONVEX_URL:`);
      console.error(`   CHATROOM_CONVEX_URL=${otherUrls[0]} chatroom task read ...`);
      console.error(`\n   Or to authenticate for the current environment:`);
    }

    console.error(`   chatroom auth login`);
    process.exit(1);
  }

  // Validate chatroomId format
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

  // Validate taskId format
  if (!taskId || typeof taskId !== 'string' || taskId.length < 20 || taskId.length > 40) {
    console.error(
      `❌ Invalid task ID format: ID must be 20-40 characters (got ${taskId?.length || 0})`
    );
    process.exit(1);
  }

  // Call the readTask mutation
  try {
    const result = await d.backend.mutation(api.tasks.readTask, {
      sessionId,
      chatroomId: chatroomId as Id<'chatroom_rooms'>,
      role,
      taskId: taskId as Id<'chatroom_tasks'>,
    });

    // Success - display the task content
    console.log(`✅ Task content:`);
    console.log(`   Task ID: ${result.taskId}`);
    console.log(`   Status: ${result.status}`);

    // Display pinned context if available
    if (result.context) {
      console.log('');
      console.log('PINNED CONTEXT');
      console.log('---');
      console.log('<context>');
      console.log(result.context.content);
      console.log('</context>');

      if (result.context.triggerMessageContent) {
        console.log('in response to');
        const senderTag = result.context.triggerMessageSenderRole ?? 'unknown';
        console.log(`<${senderTag}-message>`);
        console.log(result.context.triggerMessageContent);
        console.log(`</${senderTag}-message>`);
      }

      // Staleness notice
      const hoursAgo = Math.round(result.context.elapsedHours);
      const msgsSince = result.context.messagesSinceContext;
      const isStale = hoursAgo >= 24 || msgsSince >= 50;
      if (isStale) {
        const ageLabel =
          hoursAgo >= 48
            ? `${Math.round(hoursAgo / 24)}d old`
            : hoursAgo >= 24
              ? `${hoursAgo}h old`
              : `${msgsSince} messages old`;
        console.log(`<system-notice>`);
        console.log(`⚠️ Context is ${ageLabel}.`);
        console.log(`   Entry point role will update when needed.`);
        console.log(`</system-notice>`);
      }

      console.log('---');
    }

    console.log(`\n${result.content}`);
  } catch (error) {
    const err = error as Error;
    console.error(`❌ Failed to read task`);
    console.error(`   Error: ${err.message}`);

    // Provide helpful hints for common errors
    if (err.message.includes('not found')) {
      console.error(`\n   Verify the task ID is correct and you have access to this chatroom.`);
    } else if (err.message.includes('assigned to')) {
      console.error(`\n   This task is not assigned to your role. Use the correct --role flag.`);
    } else if (err.message.includes('acknowledged')) {
      console.error(`\n   Tasks must be in 'acknowledged' status to be read.`);
      console.error(`   If this task is already in_progress, this might be a recovery situation.`);
    }

    process.exit(1);
  }
}