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

  // Full command helper
  const cmd = (subcommand: string) => `\`${cliEnvPrefix}chatroom ${subcommand} --chatroom-id=${chatroomIdArg} --role=${roleArg}\``;

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

1. **List available skills** before planning: ${cmd('skill list')}
2. **Activate workflow skill**: ${cmd('skill activate workflow')}

3. **Create workflow**:
   \`\`\`
   ${cliEnvPrefix}chatroom workflow create --chatroom-id=${chatroomIdArg} --role=${roleArg} --workflow-key="feature-name" << 'EOF'
   {"steps": [
     {"stepKey": "design", "description": "Define types + API surface", "dependsOn": [], "order": 1},
     {"stepKey": "backend", "description": "Backend implementation", "dependsOn": ["design"], "order": 2},
     {"stepKey": "frontend", "description": "Frontend integration", "dependsOn": ["backend"], "order": 3},
     {"stepKey": "tests", "description": "Tests + verification", "dependsOn": ["frontend"], "order": 4},
     {"stepKey": "review", "description": "Code review", "dependsOn": ["tests"], "order": 5}
   ]}
   EOF
   \`\`\`

⚠️ **Anti-pattern:** Avoid the trivial 2-step \`implement → review\` workflow unless the task is genuinely a single-file change. Decompose by layer (data model → backend → frontend → tests → review) or by feature slice.

4. **Specify** each step: ${cmd('workflow specify --workflow-key="<key>" --step-key="<step>" --assignee-role="<role>"')}
   - Provide GOAL, SKILLS, REQUIREMENTS, WARNINGS via heredoc
   - **SKILLS**: Include full \`${cliEnvPrefix}chatroom skill activate <name> --chatroom-id=${chatroomIdArg} --role=${roleArg}\` commands that the assignee should run
   - Use the \`skill list\` output from step 1 to choose the right skills per step
5. **Execute**: ${cmd('workflow execute --workflow-key="<key>"')}
6. **Delegate**: handoff with ${cmd('workflow step-view --workflow-key="<key>" --step-key="<step>"')} command
7. **On handback**: ${cmd('workflow step-complete --workflow-key="<key>" --step-key="<step>"')} or hand back with feedback
8. **Check next**: ${cmd('workflow status --workflow-key="<key>"')} → delegate, self-handle, or deliver

⚠️ Workflows complete automatically when all steps are done. Only use ${cmd('workflow exit --workflow-key="<key>"')} to abandon.

**Step specification quality:**
When specifying steps with \`workflow specify\`, include:
- **Exact file paths**: List every file to be created/modified with full paths
- **Interface definitions**: For key files, include TypeScript interfaces inline
This enables the builder to understand exact expectations and ensures coherence across steps.

**Code review:** Include a review step for code-producing workflows. Activate with: ${cmd('skill activate code-review')}

**Backlog items:** When task originates from a backlog item, activate backlog skill: ${cmd('skill activate backlog')}

**If stuck:** After 2 failed rework attempts → ${cmd('workflow exit --workflow-key="<key>"')} with reason → replan or deliver partial results.

**Review loop:**
- Review completed work before moving to the next phase
- Send back with specific feedback if requirements aren't met
- ${feedingNote}`;
}
