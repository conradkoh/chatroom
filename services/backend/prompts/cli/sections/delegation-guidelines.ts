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
    ? 'Do NOT hand the builder a full implementation plan upfront — feed phases incrementally'
    : 'When implementing yourself, tackle one layer at a time — avoid large monolithic changes';

  const cliEnvPrefix = options?.cliEnvPrefix ?? '';
  const chatroomIdArg = options?.chatroomId ? `"${options.chatroomId}"` : '<id>';
  const roleArg = options?.role ? `"${options.role}"` : '<role>';

  return `**Delegation Guidelines:**

Break complex features into small, focused phases — delegate **one phase at a time** and never leave the codebase in a broken state between phases.

For clean architecture layer order, SOLID principles, and phase design standards:
\`\`\`bash
${cliEnvPrefix}chatroom skill activate software-engineering --chatroom-id=${chatroomIdArg} --role=${roleArg}
\`\`\`

**When to use a workflow:**
If the task is a single-step change (one clear deliverable, one handoff), do it directly — no workflow needed. **For any task with 2 or more steps**, you MUST use a workflow. This applies whether you are delegating to a builder or implementing yourself. Workflows make the plan visible, trackable, and recoverable. Each workflow step should represent one logical unit of work that can be verified independently. Aim for 2–7 steps per workflow.

**For any multi-step task (2+ steps):** You MUST use the workflow skill to plan and track execution. Follow this process:

1. **Activate the workflow skill:**
   \`\`\`bash
   ${cliEnvPrefix}chatroom skill activate workflow --chatroom-id=${chatroomIdArg} --role=${roleArg}
   \`\`\`
2. **Create the workflow DAG** with all steps using \`workflow create\` (activate the workflow skill first for the full command reference and JSON schema)
3. **Specify each step** using \`workflow specify\`. Each step needs:
   \`\`\`
   ${cliEnvPrefix}chatroom workflow specify --chatroom-id=${chatroomIdArg} --role=${roleArg} --workflow-key=<key> --step-key=<stepKey> --assignee-role=<role> << 'EOF'
   ---GOAL---
   [What this step should accomplish]
   ---SKILLS---
   ${cliEnvPrefix}chatroom skill activate software-engineering --chatroom-id=${chatroomIdArg} --role=<assignee-role>
   [List each skill activation command, one per line]
   ---REQUIREMENTS---
   1. [Specific deliverables]
   2. [Verification criteria]
   ---WARNINGS---
   [Things to avoid — optional]
   EOF
   \`\`\`
4. **Execute the workflow** using \`workflow execute\`
5. **Delegate the current step** using this handoff template:
   \`\`\`
   ## Workflow Step: <stepKey>
   Run this command to see your task:
   ${cliEnvPrefix}chatroom workflow step-view --chatroom-id=${chatroomIdArg} --role=${roleArg} --workflow-key=<key> --step-key=<stepKey>
   Complete the work, then hand off back to planner.
   \`\`\`
6. **On handback:** Review the work. If acceptable, run \`workflow step-complete\`. If not, hand back with specific feedback.
7. **Check next steps:** Run \`workflow status\` to see what's next:
   - If a step is assigned to you, do it yourself and run \`report-progress\`
   - If assigned to another agent, go to step 5
   - If no steps remain, the workflow completes automatically — deliver to user

⚠️ Do NOT run \`workflow exit\` to finish a successful workflow — workflows complete automatically when all steps are done. Use \`workflow exit\` only to abandon a workflow that isn't working.

**If the plan isn't working:** If a step fails after 2 rework attempts, exit the workflow with \`workflow exit\` and a reason, then replan with a different approach or deliver partial results to the user.

**Review loop:**
- After each phase, review the completed work before delegating the next
- If it doesn't meet requirements, send it back with specific feedback before moving on
- ${feedingNote}`;
}
