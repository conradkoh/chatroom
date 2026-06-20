/**
 * Context-gaining guidance for native-integration harnesses.
 *
 * Tasks are injected by the daemon into the session — no get-next-task loop.
 */

import { getCompactionRecoveryNote } from '../../cli/get-next-task/reminder';
import type { ContextGainingParams } from '../../types/cli';
import { getCliEnvPrefix } from '../../utils/index';

/**
 * Getting-started guidance for harnesses with supportsNativeIntegration.
 */
export function getNativeContextGainingGuidance(params: ContextGainingParams): string {
  const { chatroomId, role, convexUrl, agentType } = params;
  const cliEnvPrefix = getCliEnvPrefix(convexUrl);
  const typeValue = agentType && agentType !== 'unset' ? agentType : '<remote|custom>';

  return `## Getting Started

### Workflow Loop

\`\`\`mermaid
flowchart LR
    A([Start]) --> B[register-agent]
    B --> C[wait for task injection]
    C --> D[task read\nget chatroom task +\nmark in_progress]
    D --> E[Do Work]
    E --> F[handoff]
    F --> C
\`\`\`

### Native task delivery

Your harness uses **native integration**: the chatroom daemon injects tasks directly into your session context. **Do not use a blocking listen loop** — tasks arrive via injection.

When a chatroom task appears in your context, you **MUST** run \`task read\` immediately to:

1. **Get the chatroom task content** — the full description
2. **Mark it as in_progress** — signals you're working on it

Failure to run \`task read\` promptly may trigger the system to restart you.

⚠️ Remember your two-level model: completing a **chatroom task** (Level B) does NOT end your **session** (Level A). After every handoff, wait for the next task to be injected — do not exit.

Native harnesses support in-session context compaction — your session stays active and the daemon injects the next task automatically after compaction.

### Context Recovery (after compaction/summarization)

${getCompactionRecoveryNote({ cliEnvPrefix, chatroomId, role })}

### Register Agent
Register your agent type before starting work.

\`\`\`bash
${cliEnvPrefix}chatroom register-agent --chatroom-id="${chatroomId}" --role="${role}" --type=${typeValue}
\`\`\`

**Your session stays active.** The next chatroom task will be injected automatically when ready.
`;
}
