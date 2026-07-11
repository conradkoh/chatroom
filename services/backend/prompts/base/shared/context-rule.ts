/**
 * Shared context-setting rule for entry-point roles (CLI and native).
 */

/** Context rule block with the context-new command snippet and template hint. */
export function getContextRuleBlock(contextNewCmd: string, contextHint: string): string {
  return `**Context Rule:** Set a new context for every user message by default — skip ONLY when the message is clearly a follow-up of the current chatroom task. **Before running \`context new\`, run \`context read\` — if the pinned context already uses the same \`--trigger-message-id\` as this task's Origin Message ID, do NOT create another context** (avoids duplicate timeline dividers). Only the entry point role can set contexts:
\`\`\`bash
${contextNewCmd}
\`\`\`
${contextHint}`;
}
