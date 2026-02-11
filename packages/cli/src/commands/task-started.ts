/**
 * Acknowledge a task has started and classify the user message
 */

import { taskStartedCommand } from '@workspace/backend/prompts/base/cli/task-started/command.js';
import { getCliEnvPrefix } from '@workspace/backend/prompts/utils/env.js';

import { api } from '../api.js';
import type { Id } from '../api.js';
import { getSessionId, getOtherSessionUrls } from '../infrastructure/auth/storage.js';
import { getConvexClient, getConvexUrl } from '../infrastructure/convex/client.js';

interface TaskStartedOptions {
  role: string;
  originMessageClassification?: 'question' | 'new_feature' | 'follow_up';
  taskId: string;
  // Raw stdin content (for new_feature classification - backend will parse)
  rawStdin?: string;
  // Flag to skip classification (for handoff recipients)
  noClassify?: boolean;
}

export async function taskStarted(chatroomId: string, options: TaskStartedOptions): Promise<void> {
  const client = await getConvexClient();
  const { role, originMessageClassification, rawStdin, taskId, noClassify } = options;

  // Get Convex URL and CLI env prefix for generating commands
  const convexUrl = getConvexUrl();
  const cliEnvPrefix = getCliEnvPrefix(convexUrl);

  // Get session ID for authentication
  const sessionId = getSessionId();
  if (!sessionId) {
    const otherUrls = getOtherSessionUrls();

    console.error(`❌ Not authenticated for: ${convexUrl}`);

    if (otherUrls.length > 0) {
      console.error(`\n💡 You have sessions for other environments:`);
      for (const url of otherUrls) {
        console.error(`   • ${url}`);
      }
      console.error(`\n   To use a different environment, set CHATROOM_CONVEX_URL:`);
      console.error(`   CHATROOM_CONVEX_URL=${otherUrls[0]} chatroom task-started ...`);
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

  // Validate: either --no-classify OR --origin-message-classification must be provided
  if (!noClassify && !originMessageClassification) {
    console.error(`❌ Either --no-classify or --origin-message-classification is required`);
    console.error('');
    console.error('   For entry point roles (receiving user messages):');
    console.error(
      `   ${taskStartedCommand({
        chatroomId,
        role,
        taskId: '<task-id>',
        classification: 'question',
        cliEnvPrefix,
      })}`
    );
    console.error('');
    console.error('   For handoff recipients (receiving from other agents):');
    console.error(
      `   ${cliEnvPrefix}chatroom task-started --chatroom-id=${chatroomId} --role=${role} --task-id=<task-id> --no-classify`
    );
    process.exit(1);
  }

  // Validate: --no-classify and --origin-message-classification are mutually exclusive
  if (noClassify && originMessageClassification) {
    console.error(`❌ Cannot use both --no-classify and --origin-message-classification`);
    console.error(
      `   Use --no-classify for handoffs, or --origin-message-classification for user messages`
    );
    process.exit(1);
  }

  // Validate new_feature requirements (only if classifying)
  if (!noClassify && originMessageClassification === 'new_feature') {
    if (!rawStdin || rawStdin.trim().length === 0) {
      console.error(`❌ new_feature classification requires stdin with feature metadata`);
      console.error('   Provide structured stdin with TITLE, DESCRIPTION, and TECH_SPECS');
      console.error('');
      console.error('   Example:');
      console.error(
        `   echo '---TITLE---\nFeature title\n---DESCRIPTION---\nWhat this feature does\n---TECH_SPECS---\nHow to implement it' | ${taskStartedCommand(
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
  let targetTask: {
    _id: string;
    content: string;
    status: string;
  } | null = null;

  if (!taskId) {
    console.error(`❌ --task-id is required for task-started`);
    console.error(
      `   Usage: ${taskStartedCommand({
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
  targetTask = (await client.query(api.tasks.getTask, {
    sessionId,
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
    taskId: taskId as Id<'chatroom_tasks'>,
  })) as {
    _id: string;
    content: string;
    status: string;
  } | null;

  if (!targetTask) {
    console.error(`❌ Task with ID "${taskId}" not found in this chatroom`);
    console.error(`   Verify the task ID is correct and you have access to this chatroom`);
    process.exit(1);
  }

  // First, start the task (transition: acknowledged → in_progress)
  // This happens for both --no-classify and classification modes
  try {
    await client.mutation(api.tasks.startTask, {
      sessionId,
      chatroomId: chatroomId as Id<'chatroom_rooms'>,
      role,
      taskId: taskId as Id<'chatroom_tasks'>, // Pass the specific task ID
    });
  } catch (error) {
    const err = error as Error;
    console.error(`❌ Failed to start task`);
    console.error(`   Error: ${err.message}`);
    process.exit(1);
  }

  // If --no-classify, we're done (handoff recipient just needed state transition)
  if (noClassify) {
    console.log(`✅ Task started`);
    console.log(`   Task: ${targetTask.content}`);
    console.log(`\n💡 Task is now in progress. Begin your work.`);
    return;
  }

  // Otherwise, classify the message (requires task to be in_progress)
  // This is only for entry point roles receiving user messages
  try {
    const result = (await client.mutation(api.messages.taskStarted, {
      sessionId,
      chatroomId: chatroomId as Id<'chatroom_rooms'>,
      role,
      taskId: taskId as Id<'chatroom_tasks'>,
      originMessageClassification: originMessageClassification!,
      convexUrl: getConvexUrl(),
      // Send raw stdin directly to backend for parsing
      ...(rawStdin && { rawStdin }),
    })) as { success: boolean; classification: string; reminder: string };

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
    if (typeof error === 'object' && error !== null) {
      const errObj = error as any;
      if (errObj.data) {
        console.error(`   Server details:`, JSON.stringify(errObj.data, null, 2));
      }
    }

    process.exit(1);
  }
}
