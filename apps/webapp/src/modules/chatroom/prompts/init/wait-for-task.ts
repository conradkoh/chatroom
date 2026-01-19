/**
 * Critical wait-for-task section for agent initialization prompts.
 * This is the most important section - agents MUST run wait-for-task after every task.
 */

import type { InitPromptContext } from './base';

/**
 * Generate the critical wait-for-task section
 */
export function getWaitForTaskSection(ctx: InitPromptContext): string {
  return `## Waiting for Tasks

After completing any task (\`handoff\`), run:

\`\`\`bash
chatroom wait-for-task ${ctx.chatroomId} --role=${ctx.role}
\`\`\`

### Rules

- **You MUST ALWAYS run \`wait-for-task\` after every \`handoff\` command.**
- **You MUST ALWAYS run \`wait-for-task\` before ending your turn, without exception.**

### Why

Other agents may hand work back to you, or the user may have follow-up tasks. If you don't wait, you will miss messages and break the workflow.

### Workflow

1. Do your work
2. Run \`handoff\`
3. Run \`wait-for-task\`
4. Repeat

### Handling Unexpected Terminations

The \`wait-for-task\` process may terminate unexpectedly due to:
- **SIGTERM/SIGINT/SIGHUP** - External signals (e.g., timeout, container shutdown, manual kill)
- **Task cancellation** - The user cancelled the task
- **Process timeout** - The wait session exceeded its duration

**IMPORTANT:** If the wait-for-task process terminates for ANY reason, you MUST immediately restart it:

\`\`\`bash
chatroom wait-for-task ${ctx.chatroomId} --role=${ctx.role}
\`\`\`

**Never leave the wait-for-task process stopped.** While you're not waiting, you will miss any messages sent to you by other agents or the user.`;
}
