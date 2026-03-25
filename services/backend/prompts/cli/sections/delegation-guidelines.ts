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
  options?: { cliEnvPrefix?: string }
): string {
  const feedingNote = config.hasBuilder
    ? 'Do NOT hand the builder a full implementation plan upfront — feed phases incrementally'
    : 'When implementing yourself, tackle one layer at a time — avoid large monolithic changes';

  const cliEnvPrefix = options?.cliEnvPrefix ?? '';

  return `**Delegation Guidelines:**

Break complex features into small, focused phases — delegate **one phase at a time** and never leave the codebase in a broken state between phases.

For clean architecture layer order, SOLID principles, and phase design standards:
\`\`\`bash
${cliEnvPrefix}chatroom skill activate software-engineering --chatroom-id=<id> --role=<role>
\`\`\`

**For complex tasks (3+ phases):** You MUST use the workflow skill to plan and track execution. Follow this process:

1. **Activate the workflow skill:**
   \`\`\`bash
   ${cliEnvPrefix}chatroom skill activate workflow --chatroom-id=<id> --role=<role>
   \`\`\`
2. **Create the workflow DAG** with all steps using \`workflow create\`
3. **Specify each step** with goal, requirements, warnings, and assignee using \`workflow specify\`
4. **Execute the workflow** using \`workflow execute\`
5. **Delegate the current step:** Hand off to the step's assignee with a message telling them to run \`workflow step-view --workflow-key=<key> --step-key=<stepKey>\` to see their task details, then hand back when done
6. **On handback:** Review the work. If acceptable, run \`workflow step-complete\`. If not, hand back with specific feedback.
7. **Check next steps:** Run \`workflow status\` to see what's next:
   - If a step is assigned to you, do it yourself and run \`report-progress\`
   - If assigned to another agent, go to step 5
   - If no steps remain, the workflow completes automatically

In the step specification, explicitly list any skills that should be activated (e.g., \`software-engineering\`, \`code-review\`) with their full activation commands.

**Review loop:**
- After each phase, review the completed work before delegating the next
- If it doesn't meet requirements, send it back with specific feedback before moving on
- ${feedingNote}`;
}
