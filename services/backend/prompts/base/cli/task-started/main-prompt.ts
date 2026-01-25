/**
 * Main CLI prompt for the task-started command.
 */

import { taskStartedCommand } from './command.js';

/**
 * Generate the main CLI prompt for task-started command
 */
export function getTaskStartedPrompt(ctx: {
  chatroomId: string;
  role: string;
  cliEnvPrefix?: string;
}): string {
  const cliEnvPrefix = ctx.cliEnvPrefix || '';

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
