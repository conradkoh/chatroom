/**
 * Context-gaining guidance for agents joining mid-conversation.
 *
 * When agents start in a new window/session, they need to understand
 * the conversation history and code changes to provide continuity.
 *
 * Note: Available actions are now provided separately via get-next-task
 * task delivery flow, not in the context-gaining prompt.
 */

import type { ContextGainingParams } from '../../types/cli';
import { getCliEnvPrefix } from '../../utils/index';
import { getCompactionRecoveryNote } from '../../cli/get-next-task/reminder';

/**
 * Get context-gaining guidance for agents joining a conversation.
 * Provides basic context commands without available actions.
 * Available actions are provided when tasks are delivered via get-next-task.
 */
export function getContextGainingGuidance(params: ContextGainingParams): string {
  const { chatroomId, role, convexUrl, agentType } = params;
  const cliEnvPrefix = getCliEnvPrefix(convexUrl);
  const typeValue = agentType && agentType !== 'unset' ? agentType : '<remote|custom>';

  return `## Getting Started

### Workflow Loop

\`\`\`mermaid
flowchart LR
    A([Start]) --> B[register-agent]
    B --> C[get-next-task\nwaiting...]
    C --> D[task-started\nclassify]
    D --> E[Do Work]
    E --> F[handoff]
    F --> C
\`\`\`

### Context Recovery (after compaction/summarization)

${getCompactionRecoveryNote({ cliEnvPrefix, chatroomId, role })}

### Register Agent
Register your agent type before starting work.

\`\`\`bash
${cliEnvPrefix}chatroom register-agent --chatroom-id="${chatroomId}" --role="${role}" --type=${typeValue}
\`\`\`

### Read Context
View the conversation history and pending tasks for your role.

\`\`\`bash
${cliEnvPrefix}chatroom context read --chatroom-id="${chatroomId}" --role="${role}"
\`\`\`

### Get Next Task
Listen for incoming tasks assigned to your role.

\`\`\`bash
${cliEnvPrefix}chatroom get-next-task --chatroom-id="${chatroomId}" --role="${role}"
\`\`\``;
}
