/**
 * Available Actions generator for get-next-task command.
 *
 * Generates the Available Actions section shown to agents.
 * This is designed to be progressively disclosed based on the current stage.
 */

import { getCliEnvPrefix } from '../../utils/index';
import { getHistoryRetrievalGuidance } from '../history-retrieval/guidance';

export interface AvailableActionsParams {
  chatroomId: string;
  role: string;
  convexUrl: string;
}

/**
 * Generate the Available Actions section for get-next-task.
 * These are the core actions available to agents at any stage.
 */
export function getAvailableActions(params: AvailableActionsParams): string {
  const { chatroomId, role, convexUrl } = params;
  const cliEnvPrefix = getCliEnvPrefix(convexUrl);

  return `## Available Actions

${getHistoryRetrievalGuidance({ chatroomId, role, cliEnvPrefix })}

### View Code Changes
Check recent commits for implementation context.

\`\`\`bash
git log --oneline -10
\`\`\`

### Backlog
For backlog commands, activate the backlog skill:

\`\`\`bash
${cliEnvPrefix}chatroom skill activate backlog --chatroom-id="${chatroomId}" --role="${role}"
\`\`\``;
}
