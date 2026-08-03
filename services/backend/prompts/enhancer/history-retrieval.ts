export interface EnhancerHistoryRetrievalParams {
  chatroomId: string;
  cliEnvPrefix: string;
}

export function getEnhancerHistoryRetrievalGuidance(
  params: EnhancerHistoryRetrievalParams
): string {
  const { chatroomId, cliEnvPrefix } = params;
  return `## Message history

You only receive the planner check-in — not prior chatroom messages. **Do not rely solely on the planner's \`<user-message>\`, \`<grounding>\`, or pinned context**; it may omit or misstate what the user asked.

Download recent messages to read the user's request and what preceded it:

\`\`\`bash
${cliEnvPrefix}chatroom messages download --chatroom-id="${chatroomId}" --role="enhancer" --format=linear --limit=10
\`\`\`

Use the **absolute path** printed by the CLI. If output shows \`truncated=true\`, re-run with a higher \`--limit\` (e.g. 50, 100). If the user's message is not in the downloaded set, re-run with a higher \`--limit\` until you find it. Search the manifest for \`"senderRole": "user"\` (or filenames matching \`_user-to-\`) to locate the user's messages.`;
}
