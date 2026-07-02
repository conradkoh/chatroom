/**
 * Shared context-setting rule for entry-point roles (CLI and native).
 */

/** Context rule block with the context-new command snippet and template hint. */
export function getContextRuleBlock(contextNewCmd: string, contextHint: string): string {
  return `**Context Rule:** Set a new context for every user message by default — skip ONLY when the message is clearly a follow-up of the current chatroom task. Only the entry point role can set contexts:
\`\`\`bash
${contextNewCmd}
\`\`\`
${contextHint}`;
}
