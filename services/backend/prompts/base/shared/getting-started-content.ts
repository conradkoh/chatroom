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
    C --> D[task-started\nIMMEDIATELY]
    D --> E[Do Work]
    E --> F[handoff]
    F --> C
\`\`\`

### ⚠️ CRITICAL: Run task-started Immediately

When you receive a task from \`get-next-task\`, you **MUST** run \`task-started\` immediately before doing any other work:

1. **Run task-started immediately** — This marks the task as \`in_progress\` and prevents restart loops
2. **Then begin your work** — Only after task-started succeeds

Failure to run \`task-started\` promptly may trigger the system to restart you, causing unnecessary interruptions.

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
