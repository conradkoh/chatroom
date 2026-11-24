/**
 * Task intake guidance for native-integration harnesses (init system prompt).
 */

import { getNativeTokenActivityInProgressNote } from '../base/shared/token-activity-note';

export function getNativeTaskStartedPrompt(): string {
  return `### Start working

Entry-point roles receive user messages directly. ${getNativeTokenActivityInProgressNote()}`;
}

export function getNativeChatTaskStartedPrompt(): string {
  return `### Start working

This is a Chat-mode task from the user. Answer the user directly and concisely by default — Chat mode changes the recommended ceremony for the entry point, not your team capabilities or handoff authority. If this request requires team work, you may hand off to any advertised team target. Do not add alternate delegation ceremony to the default Chat flow.`;
}

export function getNativeTaskStartedPromptForHandoffRecipient(): string {
  return `### Start Working

The task body contains your work description. Begin immediately.`;
}
