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
  originMessageClassification: 'question' | 'new_feature' | 'follow_up';
  taskId: string;
  // Feature metadata (required for new_feature classification)
  title?: string;
  description?: string;
  techSpecs?: string;
}

export async function taskStarted(chatroomId: string, options: TaskStartedOptions): Promise<void> {
  const client = await getConvexClient();
  const { role, originMessageClassification, title, description, techSpecs, taskId } = options;

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

  // Validate new_feature requirements
  if (originMessageClassification === 'new_feature') {
    const missingFields: string[] = [];
    if (!title || title.trim().length === 0) {
      missingFields.push('--title');
    }
    if (!description || description.trim().length === 0) {
      missingFields.push('--description');
    }
    if (!techSpecs || techSpecs.trim().length === 0) {
      missingFields.push('--tech-specs');
    }

    if (missingFields.length > 0) {
      console.error(`❌ new_feature classification requires feature metadata`);
      console.error(`   Missing fields: ${missingFields.join(', ')}`);
      console.error('');
      console.error('   Example:');
      console.error(
        `   ${taskStartedCommand({
          chatroomId,
          role,
          taskId: '<task-id>',
          classification: 'new_feature',
          title: 'Feature title',
          description: 'What this feature does',
          techSpecs: 'How to implement it',
          cliEnvPrefix,
        })}`
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
  // This must happen before classification
  try {
    await client.mutation(api.tasks.startTask, {
      sessionId: sessionId as any,
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

  // Now classify the message (requires task to be in_progress)
  try {
    const result = (await client.mutation(api.messages.taskStarted, {
      sessionId: sessionId as any, // SessionId branded type from convex-helpers
      chatroomId: chatroomId as Id<'chatroom_rooms'>,
      role,
      taskId: taskId as Id<'chatroom_tasks'>,
      originMessageClassification,
      convexUrl: getConvexUrl(),
      // Include feature metadata if provided (validated above for new_feature)
      ...(title && { featureTitle: title.trim() }),
      ...(description && { featureDescription: description.trim() }),
      ...(techSpecs && { featureTechSpecs: techSpecs.trim() }),
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
