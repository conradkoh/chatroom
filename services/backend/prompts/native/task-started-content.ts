/**
 * Classification guidance for native-integration harnesses (init system prompt).
 */

import { classifyCommand } from '../cli/classify/command';
import { contextNewCommand } from '../cli/context/new';

export function getNativeTaskStartedPrompt(ctx: {
  chatroomId: string;
  role: string;
  cliEnvPrefix: string;
}): string {
  const questionCmd = classifyCommand({
    chatroomId: ctx.chatroomId,
    role: ctx.role,
    taskId: '<task-id>',
    classification: 'question',
    cliEnvPrefix: ctx.cliEnvPrefix,
  });

  const followUpCmd = classifyCommand({
    chatroomId: ctx.chatroomId,
    role: ctx.role,
    taskId: '<task-id>',
    classification: 'follow_up',
    cliEnvPrefix: ctx.cliEnvPrefix,
  });

  const newFeatureCmd = classifyCommand({
    chatroomId: ctx.chatroomId,
    role: ctx.role,
    taskId: '<task-id>',
    classification: 'new_feature',
    cliEnvPrefix: ctx.cliEnvPrefix,
  });

  const contextNewCmd = contextNewCommand({
    chatroomId: ctx.chatroomId,
    role: ctx.role,
    cliEnvPrefix: ctx.cliEnvPrefix,
  });

  return `### Classify message

Task content arrives inline with injection — **do not run \`task read\`**. Classify user messages after you read the injected task.

**question** — greetings, information requests, no code changes: classify, then hand off a brief reply to the user.

\`\`\`bash
${questionCmd}
\`\`\`

**follow_up** — feedback on prior work:

\`\`\`bash
${followUpCmd}
\`\`\`

**new_feature** — new functionality (title, description, tech specs required):

\`\`\`bash
${newFeatureCmd}
\`\`\`

**Context:** Set a new context when starting substantive work (\`new_feature\` / \`follow_up\` with code). Skip context for simple **question** messages (greetings, quick clarifications). Only the entry point role can set contexts:

\`\`\`bash
${contextNewCmd}
\`\`\``;
}

export function getNativeTaskStartedPromptForHandoffRecipient(): string {
  return `### Start Working

Handoff tasks include inline content in the injection. Begin work immediately — the system marks the task as \`in_progress\` when you respond. **Do not run \`task read\`.**`;
}
