/**
 * Task intake guidance for native-integration harnesses (init system prompt).
 */

import { getContextRuleBlock } from '../base/shared/context-rule';
import { getNativeTokenActivityInProgressNote } from '../base/shared/token-activity-note';
import { contextNewCommand, contextNewHint } from '../cli/context/new';
import { contextReadCommand } from '../cli/context/read';

export function getNativeTaskStartedPrompt(ctx: {
  chatroomId: string;
  role: string;
  cliEnvPrefix: string;
  triggerMessageId?: string | undefined;
}): string {
  const contextNewCmd = contextNewCommand({
    chatroomId: ctx.chatroomId,
    role: ctx.role,
    cliEnvPrefix: ctx.cliEnvPrefix,
    triggerMessageId: ctx.triggerMessageId,
  });
  const contextReadCmd = contextReadCommand({
    chatroomId: ctx.chatroomId,
    role: ctx.role,
    cliEnvPrefix: ctx.cliEnvPrefix,
  });

  return `### Start working

Entry-point roles receive user messages directly. ${getNativeTokenActivityInProgressNote()}

${getContextRuleBlock(
  contextReadCmd,
  contextNewCmd,
  contextNewHint({ cliEnvPrefix: ctx.cliEnvPrefix })
)}`;
}

export function getNativeChatTaskStartedPrompt(): string {
  return `### Start working

This is a Chat-mode task from the user. Answer the user directly and concisely by default — Chat mode changes the recommended ceremony for the entry point, not your team capabilities or handoff authority. If this request requires team work, you may hand off to any advertised team target. Do not run \`chatroom context read\` or \`chatroom context new\` for this task. Do not invoke the enhancer as part of the default Chat flow.`;
}

export function getNativeTaskStartedPromptForHandoffRecipient(): string {
  return `### Start Working

The task body contains your work description. Begin immediately.`;
}
