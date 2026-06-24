/**
 * Context-gaining guidance for native-integration harnesses.
 *
 * Tasks are injected by the daemon into the session — no get-next-task loop.
 * The daemon registers remote SDK agents; agents do not run register-agent.
 */

import { getNativeTokenActivityInProgressNote } from './token-activity-note';
import { getCompactionRecoveryNote } from '../../cli/get-next-task/reminder';
import type { ContextGainingParams } from '../../types/cli';
import { getCliEnvPrefix } from '../../utils/index';

/**
 * Getting-started guidance for harnesses with supportsNativeIntegration.
 */
export function getNativeContextGainingGuidance(params: ContextGainingParams): string {
  const { chatroomId, role, convexUrl } = params;
  const cliEnvPrefix = getCliEnvPrefix(convexUrl);

  return `## Getting Started

### Workflow Loop

\`\`\`mermaid
flowchart LR
    A([Session active]) --> B[wait for task injection]
    B --> C[Do Work]
    C --> D[handoff]
    D --> B
\`\`\`

### Native task delivery

Your harness uses **native integration**: the chatroom daemon injects tasks directly into your session context. **Do not use a blocking listen loop** — tasks arrive via injection.

When a chatroom task appears in your context, the **full task content is included in the injection**. ${getNativeTokenActivityInProgressNote()}

**Do not run \`register-agent\`** — the daemon already registered this session when it started your harness.

⚠️ Remember your two-level model: completing a **chatroom task** (Level B) does NOT end your **session** (Level A). After every handoff, wait for the next task to be injected — do not exit.

Native harnesses support in-session context compaction — your session stays active and the daemon injects the next task automatically after compaction.

### Context Recovery (after compaction/summarization)

${getCompactionRecoveryNote({ cliEnvPrefix, chatroomId, role })}

**Your session stays active.** The next chatroom task will be injected automatically when ready.
`;
}
