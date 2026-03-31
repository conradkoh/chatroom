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

Break complex features into small, focused phases — delegate **one phase at a time** and never leave the codebase in a broken state between phases.

For architecture/SOLID guidance, activate the \`software-engineering\` skill.

**When to use a workflow:**
Single-step tasks (one file fix, a question, running a command) → do directly. **2+ steps → MUST use a workflow.** Aim for 2–7 steps per workflow; each step should be independently verifiable.

**Workflow process:**

1. **Activate** the workflow skill:
   \`${cliEnvPrefix}chatroom skill activate workflow --chatroom-id=${chatroomIdArg} --role=${roleArg}\`
2. **Create** the workflow DAG using \`workflow create\`
3. **Specify** each step using \`workflow specify\` (GOAL, SKILLS, REQUIREMENTS, WARNINGS)
4. **Execute** the workflow using \`workflow execute\`
5. **Delegate** the current step via handoff with \`workflow step-view\` command
6. **On handback:** Review. If acceptable → \`workflow step-complete\`. If not → hand back with feedback.
7. **Check next:** \`workflow status\` → do it yourself, delegate, or deliver to user if all done

⚠️ Workflows complete automatically when all steps are done. Only use \`workflow exit\` to abandon.

**Code review:** Include a final review step for code-producing workflows. Activate \`code-review\` skill for the 8-pillar framework.

**Backlog items:** When the task originates from a backlog item (attached as \`<attachment type="backlog-item">\`), activate the \`backlog\` skill for lifecycle management (mark-for-review, scoring, completion).

**If stuck:** After 2 failed rework attempts → \`workflow exit\` with reason → replan or deliver partial results.

**Review loop:**
- Review completed work before moving to the next phase
- Send back with specific feedback if requirements aren't met
- ${feedingNote}`;
}
