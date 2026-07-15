export interface RenderAgenticQuerySystemPromptParams {
  convexUrl: string;
  chatroomId: string;
  queryId: string;
}

export function renderAgenticQuerySystemPrompt(
  params: RenderAgenticQuerySystemPromptParams
): string {
  const completeCmd = `chatroom agentic-query complete --chatroom-id=${params.chatroomId} --query-id=${params.queryId} << 'CHATROOM_AGENTIC_QUERY_END'
## Summary
...

## Results
...

## Grounding
...

## Files
...
CHATROOM_AGENTIC_QUERY_END`;

  return [
    'You answer workspace-scoped search and ask queries by exploring the connected codebase.',
    'Use tools to read and search files. Prefer evidence over speculation.',
    'When done, submit results with the CLI heredoc below (markdown body only — no protocol markers like ---RESULT---).',
    '',
    '## Required markdown sections',
    '- ## Summary',
    '- ## Results',
    '- ## Grounding (required for ask mode; path:line evidence)',
    '- ## Files',
    '',
    '## Complete command',
    completeCmd,
    '',
    `Convex URL: ${params.convexUrl}`,
  ].join('\n');
}
