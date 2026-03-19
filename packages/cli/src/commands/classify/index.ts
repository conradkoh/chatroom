/**
 * Classify command — classify a task's origin message (entry-point role only)
 *
 * This command is reserved for the entry-point role. It performs
 * the classification logic for the origin message.
 *
 * Entry-point roles: Use this when you receive a user message and need to classify it.
 * Other roles: Classification is not needed — use `task read` to mark in_progress.
 */

import { classifyCommand } from '@workspace/backend/prompts/cli/classify/command.js';
import { getCliEnvPrefix } from '@workspace/backend/prompts/utils/env.js';

import type { ClassifyDeps } from './deps.js';
import { api } from '../../api.js';
import type { Id } from '../../api.js';
import { getSessionId, getOtherSessionUrls } from '../../infrastructure/auth/storage.js';
import { getConvexClient, getConvexUrl } from '../../infrastructure/convex/client.js';

// ─── Re-exports for testing ────────────────────────────────────────────────

export type { ClassifyDeps } from './deps.js';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface ClassifyOptions {
  role: string;
  originMessageClassification: 'question' | 'new_feature' | 'follow_up';
  taskId: string;
  rawStdin?: string;
}

// ─── Default Deps Factory ──────────────────────────────────────────────────

async function createDefaultDeps(): Promise<ClassifyDeps> {
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

export async function classify(
  chatroomId: string,
  options: ClassifyOptions,
  deps?: ClassifyDeps
): Promise<void> {
  const d = deps ?? (await createDefaultDeps());
  const { role, originMessageClassification, rawStdin, taskId } = options;

  // Get Convex URL and CLI env prefix for generating commands
  const convexUrl = d.session.getConvexUrl();
  const cliEnvPrefix = getCliEnvPrefix(convexUrl);

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
      console.error(`   CHATROOM_CONVEX_URL=${otherUrls[0]} chatroom classify ...`);
      console.error(`\n   Or to authenticate for the current environment:`);
    }

    console.error(`   chatroom auth login`);
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

  // Fetch the chatroom to get its configuration (for entry point check)
  const chatroom = await d.backend.query(api.chatrooms.get, {
    sessionId,
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
  });

  if (!chatroom) {
    console.error(`❌ Chatroom not found: ${chatroomId}`);
    console.error(`   Verify the chatroom ID is correct and you have access.`);
    process.exit(1);
  }

  // Determine the entry point role
  const entryPoint = chatroom?.teamEntryPoint ?? chatroom?.teamRoles?.[0];

  // Validate: user's role must be the entry point role
  if (entryPoint && role.toLowerCase() !== entryPoint.toLowerCase()) {
    console.error(
      `❌ \`classify\` is only available to the entry point role (${entryPoint}). Your role is ${role}.`
    );
    console.error('');
    console.error('   Entry point roles receive user messages and must classify them.');
    console.error('   Other roles receive handoffs — use `task read` to mark in_progress.');
    process.exit(1);
  }

  // Validate new_feature requirements
  if (originMessageClassification === 'new_feature') {
    if (!rawStdin || rawStdin.trim().length === 0) {
      console.error(`❌ new_feature classification requires stdin with feature metadata`);
      console.error('   Provide structured stdin with TITLE, DESCRIPTION, and TECH_SPECS');
      console.error('');
      console.error('   Example:');
      console.error(
        `   echo '---TITLE---\nFeature title\n---DESCRIPTION---\nWhat this feature does\n---TECH_SPECS---\nHow to implement it' | ${classifyCommand(
          {
            chatroomId,
            role,
            taskId: '<task-id>',
            classification: 'new_feature',
            cliEnvPrefix,
          }
        )}`
      );
      process.exit(1);
    }
  }

  // Find the target task to acknowledge
  if (!taskId) {
    console.error(`❌ --task-id is required for classify`);
    console.error(
      `   Usage: ${classifyCommand({
        chatroomId: '<chatroomId>',
        role: '<role>',
        taskId: '<task-id>',
        classification: 'question',
        cliEnvPrefix,
      })}`
    );
    process.exit(1);
  }

  // Fetch the specific task by ID directly
  const targetTask = await d.backend.query(api.tasks.getTask, {
    sessionId,
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
    taskId: taskId as Id<'chatroom_tasks'>,
  });

  if (!targetTask) {
    console.error(`❌ Task with ID "${taskId}" not found in this chatroom`);
    console.error(`   Verify the task ID is correct and you have access to this chatroom`);
    process.exit(1);
  }

  // First, start the task (transition: acknowledged → in_progress)
  try {
    await d.backend.mutation(api.tasks.startTask, {
      sessionId,
      chatroomId: chatroomId as Id<'chatroom_rooms'>,
      role,
      taskId: taskId as Id<'chatroom_tasks'>,
    });
  } catch (error) {
    const err = error as Error;
    console.error(`❌ Failed to start task`);
    console.error(`   Error: ${err.message}`);
    process.exit(1);
  }

  // Classify the message (requires task to be in_progress)
  // This is only for entry point roles receiving user messages
  try {
    const result = await d.backend.mutation(api.messages.taskStarted, {
      sessionId,
      chatroomId: chatroomId as Id<'chatroom_rooms'>,
      role,
      taskId: taskId as Id<'chatroom_tasks'>,
      originMessageClassification: originMessageClassification,
      convexUrl: d.session.getConvexUrl(),
      ...(rawStdin && { rawStdin }),
    });

    console.log(`✅ Task acknowledged and classified`);
    console.log(`   Classification: ${originMessageClassification}`);
    console.log(`   Task: ${targetTask.content}`);

    // Display the focused reminder from the backend
    if (result.reminder) {
      console.log(`\n💡 ${result.reminder}`);
    }
  } catch (error) {
    const err = error as Error;
    console.error(`❌ Failed to acknowledge task`);
    console.error(`   Error: ${err.message}`);

    // Try to extract more details from the error if available
    if ('stack' in err && err.stack) {
      const stackLines = err.stack.split('\n').slice(0, 5);
      console.error(`   Stack trace:`);
      stackLines.forEach((line) => console.error(`     ${line}`));
    }

    // Check if this is a Convex error with more details
    if (typeof error === 'object' && error !== null && 'data' in error) {
      const errData = (error as { data: unknown }).data;
      if (errData) {
        console.error(`   Server details:`, JSON.stringify(errData, null, 2));
      }
    }

    process.exit(1);
  }
}
