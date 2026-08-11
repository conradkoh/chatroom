/**
 * Shared context-setting rule for entry-point roles (CLI and native).
 */

/** Context rule block with context-read + context-new command snippets and template hint. */
export function getContextRuleBlock(
  contextReadCmd: string,
  contextNewCmd: string,
  contextHint: string
): string {
  return `**Context Rule:** Set a new context for every user message by default — skip ONLY when the message is clearly a follow-up of the current chatroom task. **Before running context new, run:**
\`${contextReadCmd}\`
— check only whether the pinned context's \`--trigger-message-id\` matches this task's Origin Message ID (do NOT create another context if it matches). **If a staleness warning is present, do not act on the stale goal — create a new context for the current user message.** Only the entry point role can set contexts:
\`\`\`bash
${contextNewCmd}
\`\`\`
${contextHint}`;
}
