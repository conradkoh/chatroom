import { getWorkspaceAgentGuidance } from '../cli/roles/workspace-agent.js';
import { AGENTIC_QUERY_STDIN_DELIMITER } from '../cli/stdin-heredoc.js';

export interface RenderWorkspaceAgentSystemPromptParams {
  convexUrl: string;
  chatroomId?: string;
  queryId?: string;
}

/**
 * System prompt injected into opencode direct-harness sessions for agentic queries.
 * Uses the built-in `build` agent with chatroom overlay instructions.
 */
export function renderWorkspaceAgentSystemPrompt(
  params: RenderWorkspaceAgentSystemPromptParams
): string {
  const guidance = getWorkspaceAgentGuidance({
    role: 'workspace-agent',
    convexUrl: params.convexUrl,
  });

  const completeExample =
    params.chatroomId && params.queryId
      ? `chatroom agentic-query complete --chatroom-id=${params.chatroomId} --query-id=${params.queryId} --role=workspace-agent << '${AGENTIC_QUERY_STDIN_DELIMITER}'
---RESULT---
## Summary
...

## Results
...

## Grounding
...

## Files
...
${AGENTIC_QUERY_STDIN_DELIMITER}`
      : `chatroom agentic-query complete --chatroom-id=<id> --query-id=<id> --role=workspace-agent`;

  return [
    guidance,
    '',
    '## Output contract',
    'Your final assistant message MUST be valid completion markdown with these sections:',
    '- ## Summary',
    '- ## Results',
    '- ## Grounding (required for ask mode; path:line evidence)',
    '- ## Files',
    '',
    'Prefer completing via the CLI (shell tool) using a heredoc:',
    completeExample,
    '',
    'If the CLI succeeds, still emit the same markdown as your final message.',
  ].join('\n');
}
