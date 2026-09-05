/**
 * Canonical conversation-mode contract.
 *
 * A conversation mode is an immutable per-message snapshot captured at send
 * time from the user's explicit selection. It replaces the legacy boolean
 * `plannerEnhancerEnabled` as the source of truth while remaining backward
 * compatible with existing rows and callers that omit the field.
 *
 * Legacy undefined fields continue to use live-config fallback behaviour.
 */

/** The three legal conversation modes, in canonical cycle order. */
export const CONVERSATION_MODES = ['chat', 'code', 'code:enhanced'] as const;

/** Union type derived from the canonical mode literals. */
export type ConversationMode = (typeof CONVERSATION_MODES)[number];

const MODE_INDEX: Record<ConversationMode, number> = {
  chat: 0,
  code: 1,
  'code:enhanced': 2,
};

/**
 * Returns the next mode in the canonical cycle order.
 * chat → code → code:enhanced → chat
 */
export function nextConversationMode(mode: ConversationMode): ConversationMode {
  const nextIndex = (MODE_INDEX[mode] + 1) % CONVERSATION_MODES.length;
  return CONVERSATION_MODES[nextIndex];
}

/**
 * Maps the legacy boolean `plannerEnhancerEnabled` to a conversation mode.
 * `undefined` or `false` → `code` (the historical default).
 * `true` → `code:enhanced`.
 *
 * Use this only when translating old callers/rows that lack an explicit mode.
 */
export function legacyConversationMode(plannerEnhancerEnabled?: boolean): ConversationMode {
  return plannerEnhancerEnabled ? 'code:enhanced' : 'code';
}

/**
 * Derives the legacy `plannerEnhancerEnabled` boolean from an explicit mode.
 * Only `code:enhanced` maps to `true`; all others map to `false`.
 *
 * When the mode is undefined (legacy caller), the caller should continue to
 * resolve the boolean from live enhancer config rather than using this helper.
 */
export function plannerEnhancerEnabledForMode(mode: ConversationMode): boolean {
  return mode === 'code:enhanced';
}

/** Convex-compatible validator for the conversationMode field. */
export function conversationModeValidator() {
  // Lazy import to avoid circular deps; consumers should import from 'convex/values' directly.
  // This helper is only for reference — schema.ts builds its own v.union.
  return null;
}
