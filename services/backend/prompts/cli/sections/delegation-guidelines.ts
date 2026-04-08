/**
 * Delegation guidelines section for the planner role.
 *
 * When a builder is available, guidance focuses on delegation discipline.
 * When the planner is implementing themselves, guidance focuses on
 * incremental self-implementation (the planner's implementer metarole).
 */

import type { TeamCompositionConfig } from './team-composition';

/**
 * Generate the Delegation Guidelines section.
 */
export function getDelegationGuidelinesSection(
  config: Pick<TeamCompositionConfig, 'hasBuilder'>,
  options?: { cliEnvPrefix?: string; chatroomId?: string; role?: string }
): string {
  const feedingNote = config.hasBuilder
    ? 'Feed phases to the builder incrementally — one at a time, not all at once'
    : 'When implementing yourself, tackle one layer at a time — avoid large monolithic changes';

  const cliEnvPrefix = options?.cliEnvPrefix ?? '';
  const chatroomIdArg = options?.chatroomId ? `"${options.chatroomId}"` : '<id>';
  const roleArg = options?.role ? `"${options.role}"` : '<role>';

  return `**Delegation Guidelines:**

Break complex features into small, focused phases. For architecture/SOLID guidance, activate the \`software-engineering\` skill.

**Decision flow:**
\`\`\`mermaid
flowchart TD
    A[Receive task] --> B{Can handle alone?}
    B -->|Yes: question, single fix| C[Handle yourself → deliver to user]
    B -->|No: needs builder| D[Create workflow]
    D --> E[Specify + execute]
    E --> F[Delegate step to builder]
    F --> G[Review output]
    G -->|Not acceptable| H[Hand back with feedback]
    H --> F
    G -->|Acceptable| I[Complete step]
    I -->|More steps| F
    I -->|All done| J[Deliver to user]
\`\`\`

**Workflow commands** (a workflow MUST exist before handing off to builder):

1. \`${cliEnvPrefix}chatroom skill activate workflow --chatroom-id=${chatroomIdArg} --role=${roleArg}\`

2. \`\`\`
   ${cliEnvPrefix}chatroom workflow create --chatroom-id=${chatroomIdArg} --role=${roleArg} --workflow-key="feature-name" << 'EOF'
   {"steps": [
     {"stepKey": "implement", "description": "Implement the feature", "dependsOn": [], "order": 1},
     {"stepKey": "review", "description": "Code review", "dependsOn": ["implement"], "order": 2}
   ]}
   EOF
   \`\`\`

3. **Specify** each step: \`workflow specify\` (GOAL, SKILLS, REQUIREMENTS, WARNINGS)
   - **SKILLS must use valid skill names** from the glossary: \`software-engineering\`, \`code-review\`, \`backlog\`
   - Implementation steps → \`software-engineering\`
   - Review steps → \`code-review\`
   - Backlog-related steps → \`backlog\`
4. **Execute**: \`workflow execute\`
5. **Delegate**: handoff with \`workflow step-view\` command
6. **On handback**: \`workflow step-complete\` or hand back with feedback
7. **Check next**: \`workflow status\` → delegate, self-handle, or deliver

⚠️ Workflows complete automatically when all steps are done. Only use \`workflow exit\` to abandon.


**Code review:** Include a review step for code-producing workflows. Activate \`code-review\` skill.

**Backlog items:** When task originates from a backlog item, activate \`backlog\` skill for lifecycle management.

**If stuck:** After 2 failed rework attempts → \`workflow exit\` with reason → replan or deliver partial results.

**Review loop:**
- Review completed work before moving to the next phase
- Send back with specific feedback if requirements aren't met
- ${feedingNote}`;
}
