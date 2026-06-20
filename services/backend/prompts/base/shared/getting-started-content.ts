/**
 * Context-gaining guidance for agents joining mid-conversation.
 *
 * When agents start in a new window/session, they need to understand
 * the conversation history and code changes to provide continuity.
 *
 * Note: Available actions are now provided separately via get-next-task
 * task delivery flow, not in the context-gaining prompt.
 */

import { getCompactionRecoveryNote } from '../../cli/get-next-task/reminder';
import type { ContextGainingParams } from '../../types/cli';
import { getCliEnvPrefix } from '../../utils/index';

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
    B --> C[get-next-task\nchatroom task notification]
    C --> D[task read\nget chatroom task +\nmark in_progress]
    D --> E[Do Work]
    E --> F[handoff]
    F --> C
\`\`\`

### ⚠️ CRITICAL: Read the chatroom task immediately

When you receive a chatroom task from \`get-next-task\`, the content is hidden. You **MUST** run \`task read\` immediately to:

1. **Get the chatroom task content** — the full description
2. **Mark it as in_progress** — signals you're working on it

Failure to run \`task read\` promptly may trigger the system to restart you.

⚠️ Remember your two-level model: completing a **chatroom task** (Level B) does NOT end your **session** (Level A). After every handoff, you must run \`get-next-task\` again to continue the session.

### Context Recovery (after compaction/summarization)

${getCompactionRecoveryNote({ cliEnvPrefix, chatroomId, role })}

CLI harnesses do not support in-session compaction. After context is lost, the daemon performs a hard restart — you must run \`get-next-task\` again to rejoin the chatroom.

### Register Agent
Register your agent type before starting work.

\`\`\`bash
${cliEnvPrefix}chatroom register-agent --chatroom-id="${chatroomId}" --role="${role}" --type=${typeValue}
\`\`\`

### Get Next Task
Listen for incoming tasks assigned to your role. A foreground \`get-next-task\` blocks until the user or team message is ready, then resolves with that message as a chatroom task—infer intent from the message rather than following numbered next-steps blindly.

\`\`\`bash
${cliEnvPrefix}chatroom get-next-task --chatroom-id="${chatroomId}" --role="${role}"
\`\`\`

**This loop never ends.** A session (Level A) processes many chatroom tasks (Level B). Each handoff completes Level B — \`get-next-task\` continues Level A. Do not stop or exit after a handoff.
`;
}
