/**
 * Shared Chat-mode task predicate.
 *
 * Reusable by CLI and native delivery paths to determine whether a task
 * should use the lean direct-conversational workflow (no context setup,
 * no enhancer/delegation ceremony, no alternate handoff targets).
 */

import type { ConversationMode } from '@workspace/shared/domain/conversation-mode';

export interface ChatModeTaskContext {
  conversationMode?: ConversationMode | undefined;
  isEntryPoint?: boolean | undefined;
  senderRole?: string | undefined;
}

/** Chat is lean only for entry-point tasks created from a user message. */
export function isChatModeEntryPointUserTask(params: ChatModeTaskContext): boolean {
  return (
    params.conversationMode === 'chat' &&
    params.isEntryPoint === true &&
    params.senderRole?.toLowerCase() === 'user'
  );
}
