import { describe, expect, it } from 'vitest';

import { getEnhancerHistoryRetrievalGuidance } from './history-retrieval';

describe('getEnhancerHistoryRetrievalGuidance', () => {
  const params = {
    chatroomId: 'room-abc',
    cliEnvPrefix: '',
    originUserMessageId: 'message-origin',
  };

  it('uses the originating user message as the authoritative history anchor', () => {
    const result = getEnhancerHistoryRetrievalGuidance(params);
    expect(result).toContain('`message-origin` as the originating user message');
    expect(result).toContain('--since-message-id="message-origin"');
    expect(result).toContain('--limit=100');
  });

  it('includes the current anchor and download conventions for enhancer', () => {
    const result = getEnhancerHistoryRetrievalGuidance(params);
    expect(result).toContain('chatroom messages anchor');
    expect(result).toContain('chatroom messages download');
    expect(result).toContain('--role="enhancer"');
    expect(result).toContain('--chatroom-id="room-abc"');
    expect(result).toContain('absolute path');
  });

  it('explains how to recover broader or truncated history', () => {
    const result = getEnhancerHistoryRetrievalGuidance(params);
    expect(result).toContain('without `--since-message-id`');
    expect(result).toContain('`truncated=true`');
    expect(result).toContain('Treat actual user messages as authoritative');
  });

  it('gives legacy jobs an explicit anchor fallback', () => {
    const result = getEnhancerHistoryRetrievalGuidance({
      chatroomId: 'room-abc',
      cliEnvPrefix: '',
    });
    expect(result).toContain('legacy job has no origin message ID');
    expect(result).toContain('--since-message-id="<origin-user-message-id>"');
  });

  it('prepends cliEnvPrefix to both commands', () => {
    const result = getEnhancerHistoryRetrievalGuidance({
      ...params,
      cliEnvPrefix: 'CHATROOM_CONVEX_URL=http://localhost:3210 ',
    });
    expect(
      result.match(/CHATROOM_CONVEX_URL=http:\/\/localhost:3210 chatroom messages/g)
    ).toHaveLength(2);
  });
});
