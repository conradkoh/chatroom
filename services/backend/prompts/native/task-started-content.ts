/**
 * Task intake guidance for native-integration harnesses (init system prompt).
 */

import { getContextRuleBlock } from '../base/shared/context-rule';
import { getNativeTokenActivityInProgressNote } from '../base/shared/token-activity-note';
import { contextNewCommand, contextNewHint } from '../cli/context/new';

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

${getContextRuleBlock(contextNewCmd, contextNewHint())}`;
}

export function getNativeTaskStartedPromptForHandoffRecipient(): string {
  return `### Start Working

The task body contains your work description. Begin immediately.`;
}
