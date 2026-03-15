/**
 * Available Actions generator for get-next-task command.
 *
 * Generates the Available Actions section shown to agents.
 * This is designed to be progressively disclosed based on the current stage.
 */

import { getCliEnvPrefix } from '../../utils/index';
import { contextNewCommand } from '../context/new';

export interface AvailableActionsParams {
  chatroomId: string;
  role: string;
  convexUrl: string;
  /** Whether this role is the team entry point (planner/coordinator). Only entry points can manage contexts. */
  isEntryPoint: boolean;
}

/**
 * Generate the Available Actions section for get-next-task.
 * These are the core actions available to agents at any stage.
 */
export function getAvailableActions(params: AvailableActionsParams): string {
  const { chatroomId, role, convexUrl, isEntryPoint } = params;
  const cliEnvPrefix = getCliEnvPrefix(convexUrl);

  const sections: string[] = [];

  sections.push(`## Available Actions

### Gain Context
View the latest relevant chat history. Use when starting a new session or when context is unclear.

\`\`\`bash
${cliEnvPrefix}chatroom context read --chatroom-id="${chatroomId}" --role="${role}"
\`\`\`

### List Messages
Query specific messages with filters.

\`\`\`bash
${cliEnvPrefix}chatroom messages list --chatroom-id="${chatroomId}" --role="${role}" --sender-role=user --limit=5 --full
\`\`\`

### View Code Changes
Check recent commits for implementation context.

\`\`\`bash
git log --oneline -10
\`\`\`

### Backlog
**After completing work on a backlog item**, mark it for user review:

\`\`\`bash
${cliEnvPrefix}chatroom backlog mark-for-review --chatroom-id="${chatroomId}" --role="${role}" --task-id=<task-id>
\`\`\`

This transitions the task to \`pending_user_review\` where the user can confirm completion or send it back for rework.

For the full backlog command reference, activate the backlog skill:

\`\`\`bash
${cliEnvPrefix}chatroom skill activate backlog --chatroom-id="${chatroomId}" --role="${role}"
\`\`\``);

  // Context management is restricted to the entry point (planner) role only
  if (isEntryPoint) {
    sections.push(`
### Context Management
Only the entry point role can create new contexts. Set a new context when a new commit is expected, to keep agents focused on the current goal.

**Create new context:**
\`\`\`bash
${contextNewCommand({ chatroomId, role, cliEnvPrefix })}
\`\`\`

**List previous contexts:**
\`\`\`bash
${cliEnvPrefix}chatroom context list --chatroom-id="${chatroomId}" --role="${role}" --limit=10
\`\`\`

When to create a new context:
- When a new commit is expected — summarize the planned changes in the new context
- When the pinned context shows staleness warnings — summarize recent progress in the new context`);
  }

  return sections.join('\n');
}
