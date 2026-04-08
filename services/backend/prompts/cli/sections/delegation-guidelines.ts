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
    B -->|No: needs builder| D[List available skills]
    D -->|skill list| E[Create workflow]
    E --> F[Specify + execute]
    F --> G[Delegate step to builder]
    G --> H[Review output]
    H -->|Not acceptable| I[Hand back with feedback]
    I --> G
    H -->|Acceptable| J[Complete step]
    J -->|More steps| G
    J -->|All done| K[Deliver to user]
\`\`\`

**Workflow commands** (a workflow MUST exist before handing off to builder):

1. **List available skills** before planning: \`${cliEnvPrefix}chatroom skill list --chatroom-id=${chatroomIdArg} --role=${roleArg}\`
2. \`${cliEnvPrefix}chatroom skill activate workflow --chatroom-id=${chatroomIdArg} --role=${roleArg}\`

3. \`\`\`
   ${cliEnvPrefix}chatroom workflow create --chatroom-id=${chatroomIdArg} --role=${roleArg} --workflow-key="feature-name" << 'EOF'
   {"steps": [
     {"stepKey": "implement", "description": "Implement the feature", "dependsOn": [], "order": 1},
     {"stepKey": "review", "description": "Code review", "dependsOn": ["implement"], "order": 2}
   ]}
   EOF
   \`\`\`

4. **Specify** each step: \`workflow specify\` (GOAL, SKILLS, REQUIREMENTS, WARNINGS)
   - **SKILLS must use valid skill names** from the \`skill list\` output above
   - Assign appropriate skills per step (e.g. \`code-review\` for review steps)
5. **Execute**: \`workflow execute\`
6. **Delegate**: handoff with \`workflow step-view\` command
7. **On handback**: \`workflow step-complete\` or hand back with feedback
8. **Check next**: \`workflow status\` → delegate, self-handle, or deliver

⚠️ Workflows complete automatically when all steps are done. Only use \`workflow exit\` to abandon.


**Code review:** Include a review step for code-producing workflows. Activate \`code-review\` skill.

**Backlog items:** When task originates from a backlog item, activate \`backlog\` skill for lifecycle management.

**If stuck:** After 2 failed rework attempts → \`workflow exit\` with reason → replan or deliver partial results.

**Review loop:**
- Review completed work before moving to the next phase
- Send back with specific feedback if requirements aren't met
- ${feedingNote}`;
}
