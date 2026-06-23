/**
 * Classification guidance for native-integration harnesses (init system prompt).
 */

import { contextNewCommand } from '../cli/context/new';

export function getNativeTaskStartedPrompt(ctx: {
  chatroomId: string;
  role: string;
  cliEnvPrefix: string;
}): string {
  const contextNewCmd = contextNewCommand({
    chatroomId: ctx.chatroomId,
    role: ctx.role,
    cliEnvPrefix: ctx.cliEnvPrefix,
  });

  return `### Classify message

Entry-point roles classify incoming user messages before planning work.

- **question** — greetings, information requests, no code changes
- **follow_up** — feedback on prior work
- **new_feature** — new functionality (title, description, tech specs via classify stdin)

Set context when starting substantive code work (\`new_feature\` / \`follow_up\`). Skip for simple **question** messages. Only the entry point role can set contexts:

\`\`\`bash
${contextNewCmd}
\`\`\``;
}

export function getNativeTaskStartedPromptForHandoffRecipient(): string {
  return `### Start Working

The task body contains your work description. Begin immediately.`;
}
