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

The \`handoff\` command **automatically waits** for your next assignment. You don't need to manually run \`wait-for-task\` after each handoff.

### Workflow

1. Do your work
2. Run \`handoff\` → automatically waits for next message
3. Receive next message and continue
4. Repeat

### Handling Unexpected Terminations

The wait process may terminate unexpectedly due to:
- **Timeout** - The wait session exceeded its duration
- **SIGTERM/SIGINT** - External signals (e.g., container shutdown, manual kill)
- **Task cancellation** - The user cancelled the task

**⚠️ CRITICAL:** If the wait process terminates for ANY reason, you MUST immediately restart it:

\`\`\`bash
chatroom wait-for-task ${ctx.chatroomId} --role=${ctx.role}
\`\`\`

**Never leave the wait process stopped.** While you're not waiting, you will miss messages from other agents or the user.

### Manual Wait Command

If you need to explicitly wait (e.g., after a timeout or when resuming work):

\`\`\`bash
chatroom wait-for-task ${ctx.chatroomId} --role=${ctx.role}
\`\`\``;
}
