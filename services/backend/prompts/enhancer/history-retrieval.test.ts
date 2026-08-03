import { describe, expect, it } from 'vitest';

import { getEnhancerHistoryRetrievalGuidance } from './history-retrieval';

describe('getEnhancerHistoryRetrievalGuidance', () => {
  const params = {
    chatroomId: 'room-abc',
    cliEnvPrefix: '',
  };

  it('contains the messages download command', () => {
    const result = getEnhancerHistoryRetrievalGuidance(params);
    expect(result).toContain('messages download');
  });

  it('pre-fills the enhancer role', () => {
    const result = getEnhancerHistoryRetrievalGuidance(params);
    expect(result).toContain('--role="enhancer"');
  });

  it('includes the chatroom id in the command', () => {
    const result = getEnhancerHistoryRetrievalGuidance(params);
    expect(result).toContain('--chatroom-id="room-abc"');
  });

  it('warns not to rely solely on planner context', () => {
    const result = getEnhancerHistoryRetrievalGuidance(params);
    expect(result).toContain('Do not rely solely');
  });

  it('includes manifest senderRole search tip', () => {
    const result = getEnhancerHistoryRetrievalGuidance(params);
    expect(result).toContain('"senderRole": "user"');
  });

  it('explains limit escalation when truncated', () => {
    const result = getEnhancerHistoryRetrievalGuidance(params);
    expect(result).toContain('truncated=true');
    expect(result).toContain('--limit');
  });

  it('prepends cliEnvPrefix when provided', () => {
    const result = getEnhancerHistoryRetrievalGuidance({
      chatroomId: 'room-abc',
      cliEnvPrefix: 'CHATROOM_CONVEX_URL=http://localhost:3210 ',
    });
    expect(result).toContain(
      'CHATROOM_CONVEX_URL=http://localhost:3210 chatroom messages download'
    );
  });
});
