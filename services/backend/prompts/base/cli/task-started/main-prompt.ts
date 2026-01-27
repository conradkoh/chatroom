/**
 * Main CLI prompt for the task-started command.
 */

import { taskStartedCommand } from './command.js';

/**
 * Generate the main CLI prompt for task-started command (entry point roles)
 */
export function getTaskStartedPrompt(ctx: {
  chatroomId: string;
  role: string;
  cliEnvPrefix: string;
}): string {
  const cliEnvPrefix = ctx.cliEnvPrefix;

  // Generate commands for each classification type
  const questionCmd = taskStartedCommand({
    chatroomId: ctx.chatroomId,
    role: ctx.role,
    taskId: '<task-id>',
    classification: 'question',
    cliEnvPrefix,
  });

  const followUpCmd = taskStartedCommand({
    chatroomId: ctx.chatroomId,
    role: ctx.role,
    taskId: '<task-id>',
    classification: 'follow_up',
    cliEnvPrefix,
  });

  const newFeatureCmd = taskStartedCommand({
    chatroomId: ctx.chatroomId,
    role: ctx.role,
    taskId: '<task-id>',
    classification: 'new_feature',
    cliEnvPrefix,
  });

  return `### Classify Task
Acknowledge and classify user messages before starting work.

#### Question
User is asking for information or clarification.

\`\`\`bash
${questionCmd}
\`\`\`

#### Follow Up
User is responding to previous work or providing feedback.

\`\`\`bash
${followUpCmd}
\`\`\`

#### New Feature
User wants new functionality. Requires title, description, and tech specs.

\`\`\`bash
${newFeatureCmd}
\`\`\``;
}

/**
 * Generate task-started prompt for non-entry point roles (handoff recipients)
 * These roles don't classify messages - they just acknowledge state transition
 */
export function getTaskStartedPromptForHandoffRecipient(ctx: {
  chatroomId: string;
  role: string;
  cliEnvPrefix: string;
}): string {
  const cliEnvPrefix = ctx.cliEnvPrefix;

  // Non-entry roles use --no-classify since classification was already done
  const taskStartedCmd = `${cliEnvPrefix}chatroom task-started --chatroom-id=${ctx.chatroomId} --role=${ctx.role} --task-id=<task-id> --no-classify`;

  return `### Start Working
Before starting work on a received message, acknowledge it:

\`\`\`bash
${taskStartedCmd}
\`\`\`

This transitions the task to \`in_progress\`. Classification was already done by the agent who received the original user message.`;
}
