import { describe, expect, it } from 'vitest';

import { renderWorkspaceAgentSystemPrompt } from './workspace-agent-system-prompt.js';

describe('renderWorkspaceAgentSystemPrompt', () => {
  it('includes simplified prompt without role or protocol markers', () => {
    const prompt = renderWorkspaceAgentSystemPrompt({
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
