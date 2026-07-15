import { describe, expect, it } from 'vitest';

import { renderAgenticQuerySystemPrompt } from './system-prompt.js';

describe('renderAgenticQuerySystemPrompt', () => {
  it('includes simplified prompt without role or protocol markers', () => {
    const prompt = renderAgenticQuerySystemPrompt({
      convexUrl: 'https://example.convex.cloud',
      chatroomId: 'room-1',
      queryId: 'query-1',
    });

    expect(prompt).toContain('agentic-query complete');
    expect(prompt).toContain('## Summary');
    expect(prompt).toContain('--query-id=query-1');
    expect(prompt).toContain('CHATROOM_AGENTIC_QUERY_END');

    // Must NOT contain old role/marker patterns
    expect(prompt).not.toContain('--role');
    expect(prompt).not.toContain('workspace-agent');
    expect(prompt).not.toMatch(/<<.*---RESULT---/);
  });
});
