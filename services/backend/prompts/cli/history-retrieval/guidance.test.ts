import { describe, expect, test } from 'vitest';

import { getHistoryRetrievalGuidance } from './guidance';

describe('getHistoryRetrievalGuidance', () => {
  test('includes source priority and truncation guidance', () => {
    const text = getHistoryRetrievalGuidance({
      chatroomId: 'room-1',
      role: 'planner',
      cliEnvPrefix: '',
    });
    expect(text).toContain('context read');
    expect(text).toContain('messages download');
    expect(text).toContain('truncated=true');
    expect(text).toContain('absolute path printed by the CLI');
  });

  test('includes messages anchor and since-message-id download', () => {
    const text = getHistoryRetrievalGuidance({
      chatroomId: 'room-1',
      role: 'planner',
      cliEnvPrefix: '',
    });
    expect(text).toContain('messages anchor');
    expect(text).toContain('--since-message-id="<id-from-anchor>" --limit=100');
  });
});
