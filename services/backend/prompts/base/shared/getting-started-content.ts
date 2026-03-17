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
    C --> D[task read\nmarks in_progress]
    D --> E[Do Work]
    E --> F[handoff]
    F --> C
\`\`\`

### ⚠️ CRITICAL: Read the task immediately

When you receive a task from \`get-next-task\`, the task content is hidden. You **MUST** run \`task read\` immediately to:

1. **Get the task content** — the full task description
2. **Mark it as in_progress** — signals you're working on it

Failure to run \`task read\` promptly may trigger the system to restart you.

### Context Recovery (after compaction/summarization)

${getCompactionRecoveryNote({ cliEnvPrefix, chatroomId, role })}

### Register Agent
Register your agent type before starting work.

\`\`\`bash
${cliEnvPrefix}chatroom register-agent --chatroom-id="${chatroomId}" --role="${role}" --type=${typeValue}
\`\`\`

### Get Next Task
Listen for incoming tasks assigned to your role.

\`\`\`bash
${cliEnvPrefix}chatroom get-next-task --chatroom-id="${chatroomId}" --role="${role}"
\`\`\`
`;
}
