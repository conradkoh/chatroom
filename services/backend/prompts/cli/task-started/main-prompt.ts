/**
 * Main CLI prompt for the task-started command.
 */

import { getContextRuleBlock } from '../../base/shared/context-rule';
import { getTokenActivityInProgressNote } from '../../base/shared/token-activity-note';
import { contextNewCommand, contextNewHint } from '../context/new';

/**
 * Generate the main CLI prompt for task-started command (entry point roles)
 */
export function getTaskStartedPrompt(ctx: {
  chatroomId: string;
  role: string;
  cliEnvPrefix: string;
  triggerMessageId?: string;
}): string {
  const { chatroomId, role, cliEnvPrefix, triggerMessageId } = ctx;

  const contextNewCmd = contextNewCommand({
    chatroomId,
    role,
    cliEnvPrefix,
    triggerMessageId,
  });

  return `### Start working

${getTokenActivityInProgressNote()}

${getContextRuleBlock(contextNewCmd, contextNewHint())}`;
}

/**
 * Generate task-started prompt for non-entry point roles (handoff recipients)
 */
export function getTaskStartedPromptForHandoffRecipient(_ctx: {
  chatroomId: string;
  role: string;
  cliEnvPrefix: string;
}): string {
  return `### Start Working

The task body contains your work description. ${getTokenActivityInProgressNote()}`;
}
