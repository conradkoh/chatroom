/**
 * Task intake guidance for native-integration harnesses (init system prompt).
 */

import { getNativeTokenActivityInProgressNote } from '../base/shared/token-activity-note';
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

  return `### Start working

Entry-point roles receive user messages directly. ${getNativeTokenActivityInProgressNote()}

Set context when starting substantive code work. Skip for simple informational messages. Only the entry point role can set contexts:

\`\`\`bash
${contextNewCmd}
\`\`\``;
}

export function getNativeTaskStartedPromptForHandoffRecipient(): string {
  return `### Start Working

The task body contains your work description. Begin immediately.`;
}
