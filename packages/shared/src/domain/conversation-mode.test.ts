import { describe, expect, test } from 'vitest';

import { CONVERSATION_MODES, nextConversationMode } from './conversation-mode';

describe('ConversationMode', () => {
  test('CONVERSATION_MODES has exactly two legal values in order', () => {
    expect(CONVERSATION_MODES).toEqual(['chat', 'code']);
  });

  test('nextConversationMode cycles chat → code → chat', () => {
    expect(nextConversationMode('chat')).toBe('code');
    expect(nextConversationMode('code')).toBe('chat');
  });

  test('every mode cycles to another legal mode', () => {
    for (const mode of CONVERSATION_MODES) {
      expect(CONVERSATION_MODES).toContain(nextConversationMode(mode));
    }
  });
});
