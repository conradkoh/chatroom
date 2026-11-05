/**
 * Canonical conversation-mode contract.
 *
 * A conversation mode is an immutable per-message snapshot captured at send
 * time from the user's explicit selection. Only `chat` and `code` are live.
 */

/** The legal conversation modes, in canonical cycle order. */
export const CONVERSATION_MODES = ['chat', 'code'] as const;

/** Union type derived from the canonical mode literals. */
export type ConversationMode = (typeof CONVERSATION_MODES)[number];

const MODE_INDEX: Record<ConversationMode, number> = {
  chat: 0,
  code: 1,
};

/**
 * Returns the next mode in the canonical cycle order.
 * chat → code → chat
 */
export function nextConversationMode(mode: ConversationMode): ConversationMode {
  const nextIndex = (MODE_INDEX[mode] + 1) % CONVERSATION_MODES.length;
  return CONVERSATION_MODES[nextIndex];
}
