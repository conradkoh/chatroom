import { describe, expect, test } from 'vitest';

import {
  CONVERSATION_MODES,
  legacyConversationMode,
  nextConversationMode,
  plannerEnhancerEnabledForMode,
} from './conversation-mode';

describe('ConversationMode', () => {
  test('CONVERSATION_MODES has exactly three legal values in order', () => {
    expect(CONVERSATION_MODES).toEqual(['chat', 'code', 'code:enhanced']);
  });

  test('nextConversationMode cycles in canonical order', () => {
    expect(nextConversationMode('chat')).toBe('code');
    expect(nextConversationMode('code')).toBe('code:enhanced');
    expect(nextConversationMode('code:enhanced')).toBe('chat');
  });

  test('legacyConversationMode maps undefined/false to code', () => {
    expect(legacyConversationMode(undefined)).toBe('code');
    expect(legacyConversationMode(false)).toBe('code');
  });

  test('legacyConversationMode maps true to code:enhanced', () => {
    expect(legacyConversationMode(true)).toBe('code:enhanced');
  });

  test('plannerEnhancerEnabledForMode returns true only for code:enhanced', () => {
    expect(plannerEnhancerEnabledForMode('chat')).toBe(false);
    expect(plannerEnhancerEnabledForMode('code')).toBe(false);
    expect(plannerEnhancerEnabledForMode('code:enhanced')).toBe(true);
  });

  test('every mode round-trips through legacy → mode → boolean', () => {
    for (const mode of CONVERSATION_MODES) {
      const bool = plannerEnhancerEnabledForMode(mode);
      const roundTripped = legacyConversationMode(bool);
      // chat and code both map to false → code, code:enhanced maps to true → code:enhanced
      if (mode === 'code:enhanced') {
        expect(roundTripped).toBe('code:enhanced');
      } else {
        expect(roundTripped).toBe('code');
      }
    }
  });
});
