/**
 * Context-gaining guidance for agents joining mid-conversation.
 *
 * When agents start in a new window/session, they need to understand
 * the conversation history and code changes to provide continuity.
 *
 * Note: Available actions are now provided separately via wait-for-task
 * task delivery flow, not in the context-gaining prompt.
 */

import type { ContextGainingParams } from '../../../types/cli.js';
import { getCliEnvPrefix } from '../../../utils/index.js';

/**
 * Get context-gaining guidance for agents joining a conversation.
 * Provides basic context commands without available actions.
 * Available actions are provided when tasks are delivered via wait-for-task.
 */
export function getContextGainingGuidance(params: ContextGainingParams): string {
  const { chatroomId, role, convexUrl } = params;
  const cliEnvPrefix = getCliEnvPrefix(convexUrl);

  return `## Getting Started

### Read Context
View the conversation history and pending tasks for your role.

\`\`\`bash
${cliEnvPrefix}chatroom context read --chatroom-id ${chatroomId} --role=${role}
\`\`\`

### Wait for Tasks
Listen for incoming tasks assigned to your role.

\`\`\`bash
${cliEnvPrefix}chatroom wait-for-task --chatroom-id ${chatroomId} --role=${role}
\`\`\``;
}
