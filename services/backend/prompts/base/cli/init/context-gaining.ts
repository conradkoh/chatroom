/**
 * Context-gaining guidance for agents joining mid-conversation.
 *
 * When agents start in a new window/session, they need to understand
 * the conversation history and code changes to provide continuity.
 */

import type { ContextGainingParams } from '../../../types/cli.js';
import { getCliEnvPrefix } from '../../../utils/index.js';
import { taskCompleteCommand } from '../task-complete/command.js';

/**
 * Get context-gaining guidance for agents joining a conversation.
 * Provides instructions for understanding both user perspective and code changes.
 */
export function getContextGainingGuidance(params: ContextGainingParams): string {
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
\`\`\``;
}
