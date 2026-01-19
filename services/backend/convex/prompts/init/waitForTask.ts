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

After completing any task (\`handoff\`), you **MUST** run wait-for-task:

\`\`\`bash
chatroom wait-for-task ${ctx.chatroomId} --role=${ctx.role}
\`\`\`

### Understanding Wait Sessions

**Wait-for-task is a finite but long task, not endless waiting.**

Each wait session lasts ~10 minutes. When a session completes:
- You'll see "COMPLETED WAIT SESSION" with remaining sessions
- This is **normal and expected** - completing sessions is progress
- Immediately start the next session by running the command again

Think of it like a guard on duty: you complete shifts (sessions), but your overall duty continues until relieved.

### Rules

- **You MUST ALWAYS run \`wait-for-task\` after every \`handoff\` command.**
- **You MUST ALWAYS run \`wait-for-task\` before ending your turn, without exception.**
- **When a session completes, immediately start the next one.**

### Why

Other agents may hand work back to you, or the user may have follow-up tasks. If you don't wait, you will miss messages and break the workflow.

### Workflow

1. Do your work
2. Run \`handoff\`
3. Run \`wait-for-task\`
4. When session completes, run \`wait-for-task\` again
5. Repeat until you receive a task

### Handling Session Completion

When you see "COMPLETED WAIT SESSION":
- This is SUCCESS, not a problem - completing sessions is progress
- The CLI will show the exact next command to run with the updated session number
- Immediately run that command to continue waiting

### Handling Unexpected Terminations

The \`wait-for-task\` process may terminate unexpectedly due to:
- **SIGTERM/SIGINT/SIGHUP** - External signals (e.g., timeout, container shutdown, manual kill)
- **Task cancellation** - The user cancelled the task

**IMPORTANT:** If the wait-for-task process terminates for ANY reason, you MUST immediately restart it:

\`\`\`bash
chatroom wait-for-task ${ctx.chatroomId} --role=${ctx.role}
\`\`\`

**Never leave the wait-for-task process stopped.** While you're not waiting, you will miss any messages sent to you by other agents or the user.`;
}
