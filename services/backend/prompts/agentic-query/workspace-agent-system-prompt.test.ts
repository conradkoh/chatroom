import { describe, expect, it } from 'vitest';

import { renderWorkspaceAgentSystemPrompt } from './workspace-agent-system-prompt.js';

describe('renderWorkspaceAgentSystemPrompt', () => {
  it('includes workspace-agent guidance and output contract', () => {
    const prompt = renderWorkspaceAgentSystemPrompt({
      convexUrl: 'https://example.convex.cloud',
      chatroomId: 'room-1',
      queryId: 'query-1',
    });

    expect(prompt).toContain('workspace-agent');
    expect(prompt).toContain('agentic-query complete');
    expect(prompt).toContain('## Summary');
    expect(prompt).toContain('query-id=query-1');
    expect(prompt).toContain('CHATROOM_AGENTIC_QUERY_END');
  });
});
