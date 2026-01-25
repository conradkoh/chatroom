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
${cliEnvPrefix}chatroom context read ${chatroomId} --role=${role}
\`\`\`

### List Messages
Query specific messages with filters.

\`\`\`bash
${cliEnvPrefix}chatroom messages list ${chatroomId} --role=${role} --sender-role=user --limit=5 --full
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
${cliEnvPrefix}chatroom backlog list ${chatroomId} --role=${role} --status=backlog
\`\`\`

More actions: \`chatroom backlog --help\``;
}
