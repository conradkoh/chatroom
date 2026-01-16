/**
 * Critical wait-for-message section for agent initialization prompts.
 * This is the most important section - agents MUST run wait-for-message after every task.
 */

import type { InitPromptContext } from './base';

/**
 * Generate the critical wait-for-message section
 */
export function getWaitForMessageSection(ctx: InitPromptContext): string {
  return `## Waiting for Messages

After completing any task (\`handoff\`), run:

\`\`\`bash
chatroom wait-for-message ${ctx.chatroomId} --role=${ctx.role}
\`\`\`

### Rules

- **You MUST ALWAYS run \`wait-for-message\` after every \`handoff\` command.**
- **You MUST ALWAYS run \`wait-for-message\` before ending your turn, without exception.**

### Why

Other agents may hand work back to you, or the user may have follow-up tasks. If you don't wait, you will miss messages and break the workflow.

### Workflow

1. Do your work
2. Run \`handoff\`
3. Run \`wait-for-message\`
4. Repeat`;
}
