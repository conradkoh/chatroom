/**
 * Available Actions generator for wait-for-task command.
 *
 * Generates the Available Actions section shown to agents.
 * This is designed to be progressively disclosed based on the current stage.
 */

import { getCliEnvPrefix } from '../../../utils/index.js';
import { taskCompleteCommand } from '../task-complete/command.js';

export interface AvailableActionsParams {
  chatroomId: string;
  role: string;
  convexUrl?: string;
}

/**
 * Generate the Available Actions section for wait-for-task.
 * These are the core actions available to agents at any stage.
 */
export function getAvailableActions(params: AvailableActionsParams): string {
  const { chatroomId, role, convexUrl } = params;
  const cliEnvPrefix = getCliEnvPrefix(convexUrl);

  return `## Available Actions

### Gain Context
View the latest relevant chat history. Use when starting a new session or when context is unclear.

\`\`\`bash
${cliEnvPrefix}chatroom context read --chatroom-id=${chatroomId} --role=${role}
\`\`\`

### List Messages
Query specific messages with filters.

\`\`\`bash
${cliEnvPrefix}chatroom messages list --chatroom-id=${chatroomId} --role=${role} --sender-role=user --limit=5 --full
\`\`\`

### View Code Changes
Check recent commits for implementation context.

\`\`\`bash
git log --oneline -10
\`\`\`

### Complete Task
Mark current task as complete without handing off to another role.

\`\`\`bash
${taskCompleteCommand({ chatroomId, role, cliEnvPrefix })}
\`\`\`

### Backlog
The chatroom has a task backlog. View items with:

\`\`\`bash
${cliEnvPrefix}chatroom backlog list --chatroom-id=${chatroomId} --role=${role} --status=backlog
\`\`\`

**After completing work on a backlog item**, mark it for user review:

\`\`\`bash
${cliEnvPrefix}chatroom backlog mark-for-review --chatroom-id=${chatroomId} --role=${role} --task-id=<task-id>
\`\`\`

This transitions the task to \`pending_user_review\` where the user can confirm completion or send it back for rework.

#### Backlog Scoring and Maintenance
When requested, help organize the backlog and score items by priority (impact vs. effort). Use \`${cliEnvPrefix}chatroom backlog list --chatroom-id=${chatroomId} --role=${role} --status=backlog\` to view items, then provide recommendations.

More actions: \`chatroom backlog --help\`

### Context Management
When the conversation drifts or after significant progress, create a new context to keep agents focused on the current goal.

**Create new context:**
\`\`\`bash
${cliEnvPrefix}chatroom context new --chatroom-id=${chatroomId} --role=${role} --content="<summary of current focus>"
\`\`\`

**List previous contexts:**
\`\`\`bash
${cliEnvPrefix}chatroom context list --chatroom-id=${chatroomId} --role=${role} --limit=10
\`\`\`

When to create a new context:
- After completing a major task or milestone
- When user shifts to a new topic
- When the pinned context shows staleness warnings (many messages or old timestamp)
- After summarizing progress at user's request`;
}
