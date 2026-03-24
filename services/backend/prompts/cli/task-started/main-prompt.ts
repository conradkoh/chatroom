/**
 * Main CLI prompt for the task-started command.
 */

import { classifyCommand } from '../classify/command';
import { contextNewCommand } from '../context/new';

/**
 * Generate the main CLI prompt for task-started command (entry point roles)
 * Uses the new `classify` command for entry-point classification.
 */
export function getTaskStartedPrompt(ctx: {
  chatroomId: string;
  role: string;
  cliEnvPrefix: string;
}): string {
  const cliEnvPrefix = ctx.cliEnvPrefix;

  // Generate commands for each classification type using the new classify command
  const questionCmd = classifyCommand({
    chatroomId: ctx.chatroomId,
    role: ctx.role,
    taskId: '<task-id>',
    classification: 'question',
    cliEnvPrefix,
  });

  const followUpCmd = classifyCommand({
    chatroomId: ctx.chatroomId,
    role: ctx.role,
    taskId: '<task-id>',
    classification: 'follow_up',
    cliEnvPrefix,
  });

  const newFeatureCmd = classifyCommand({
    chatroomId: ctx.chatroomId,
    role: ctx.role,
    taskId: '<task-id>',
    classification: 'new_feature',
    cliEnvPrefix,
  });

  const contextNewCmd = contextNewCommand({
    chatroomId: ctx.chatroomId,
    role: ctx.role,
    cliEnvPrefix,
  });

  return `### Classify Task

Acknowledge and classify user messages after reading the task.

Run this after \`task read\` to classify the message type.

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
\`\`\`

**Context Rule:** When a new commit is expected, set a new context first to keep the conversation focused. Only the entry point role can set contexts:
\`\`\`bash
${contextNewCmd}
\`\`\``;
}

/**
 * Generate task-started prompt for non-entry point roles (handoff recipients)
 * These roles don't classify messages - they just run task read to acknowledge
 */
export function getTaskStartedPromptForHandoffRecipient(_ctx: {
  chatroomId: string;
  role: string;
  cliEnvPrefix: string;
}): string {
  return `### Start Working

After receiving a handoff, run \`task read\` to get the task content and mark it as \`in_progress\`.`;
}
