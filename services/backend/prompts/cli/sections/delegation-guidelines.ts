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
  const cmd = (subcommand: string) =>
    `\`${cliEnvPrefix}chatroom ${subcommand} --chatroom-id=${chatroomIdArg} --role=${roleArg}\``;

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

   **How to decompose** — think about the phases a human engineer would actually go through to ship the work, then make each phase a step. The right phases depend entirely on what you're building. Some heuristics:

   - **Each step should name a concrete artifact** ("the X schema", "the Y entity", "the Z endpoint") — not a vague layer ("backend work", "implementation"). Weak builders fail when scope is unbounded.
   - **One step ≈ one focused review surface.** If you can't imagine reviewing it in one sitting, split it.
   - **Order by dependency**, not by team convention. A step should be runnable/testable when its dependencies are done.
   - **Skip phases that don't apply** (e.g., no frontend for a backend-only change, no schema for a pure refactor).
   - **Split a phase** when it contains multiple distinct artifacts (e.g., two unrelated use cases → two steps).
   - **Always end with a code review step** for code-producing workflows.

   **Illustrative example only** — DO NOT copy the step keys, count, or descriptions verbatim. This shows the *shape* of a good decomposition for one specific feature (adding comments to posts). Your steps will look different.

   \`\`\`
   ${cliEnvPrefix}chatroom workflow create --chatroom-id=${chatroomIdArg} --role=${roleArg} --workflow-key="<your-feature-key>" << 'EOF'
   {"steps": [
     {"stepKey": "schema",             "description": "Design the comments table schema + indexes",                "dependsOn": [],                       "order": 1},
     {"stepKey": "entities",           "description": "Define Comment domain entity + validation",                  "dependsOn": ["schema"],               "order": 2},
     {"stepKey": "use-cases",          "description": "Implement createComment/listComments use cases + unit tests","dependsOn": ["entities"],             "order": 3},
     {"stepKey": "api",                "description": "Expose use cases via API layer (mutations/queries)",         "dependsOn": ["use-cases"],            "order": 4},
     {"stepKey": "frontend-components","description": "Build CommentList + CommentForm presentational components",  "dependsOn": ["api"],                  "order": 5},
     {"stepKey": "frontend-hooks",     "description": "Wire components to API via useComments/useCreateComment",    "dependsOn": ["frontend-components"],  "order": 6},
     {"stepKey": "review",             "description": "Code review",                                                 "dependsOn": ["frontend-hooks"],       "order": 7}
   ]}
   EOF
   \`\`\`

   Other shapes are equally valid — e.g., a bug fix might be \`reproduce → fix → regression-test → review\`; a refactor might be \`extract-interface → migrate-callers → delete-old → review\`; an infra change might have no frontend phases at all. Decompose the work in front of you, not the example.

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
When specifying steps with \`workflow specify\`, give the builder enough to act without guessing:
- **Concrete artifacts**: name the files/modules to create or change (full paths when known)
- **Contracts**: when a step produces an interface other steps depend on, sketch it inline (TypeScript types, function signatures, or schema shape)
- **Acceptance criteria**: how the builder will know they're done

Adapt depth to the step — a one-file fix needs a sentence; a new module needs paths and types.

**Code review:** Include a review step for code-producing workflows. Activate with: ${cmd('skill activate code-review')}

**Backlog items:** When task originates from a backlog item, activate backlog skill: ${cmd('skill activate backlog')}

**If stuck:** After 2 failed rework attempts → ${cmd('workflow exit --workflow-key="<key>"')} with reason → replan or deliver partial results.

**Review loop:**
- Review completed work before moving to the next phase
- Send back with specific feedback if requirements aren't met
- ${feedingNote}`;
}
