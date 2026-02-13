/**
 * Planner role-specific guidance for agent initialization prompts.
 *
 * The planner is the squad team coordinator: the single point of contact
 * for the user, responsible for task decomposition, delegation, and
 * ensuring work meets requirements before delivery.
 */

import type { PlannerGuidanceParams } from '../../../types/cli.js';
import { getCliEnvPrefix } from '../../../utils/env.js';
import { taskStartedCommand } from '../task-started/command.js';

/**
 * Generate planner-specific guidance
 */
export function getPlannerGuidance(params: PlannerGuidanceParams): string {
  const { isEntryPoint, convexUrl, teamRoles, availableMembers } = params;
  const cliEnvPrefix = getCliEnvPrefix(convexUrl);
  const taskStartedExample = taskStartedCommand({ cliEnvPrefix });

  const hasBuilder = (availableMembers ?? teamRoles).some((r) => r.toLowerCase() === 'builder');
  const hasReviewer = (availableMembers ?? teamRoles).some((r) => r.toLowerCase() === 'reviewer');

  const classificationNote = isEntryPoint
    ? `
**Classification (Entry Point Role):**
As the entry point, you receive user messages directly. When you receive a user message:
1. First run \`${taskStartedExample}\` to classify the original message (question, new_feature, or follow_up)
2. **If code changes or commits are expected**, create a new context before starting work (see Context Management in Available Actions)
3. Decompose the task into actionable work items if needed
4. Delegate to the appropriate team member or handle it yourself`
    : '';

  // Build workflow guidance based on available members
  let workflowGuidance: string;
  if (hasBuilder && hasReviewer) {
    workflowGuidance = getFullTeamWorkflow();
  } else if (hasBuilder && !hasReviewer) {
    workflowGuidance = getPlannerPlusBuilderWorkflow();
  } else if (!hasBuilder && hasReviewer) {
    workflowGuidance = getPlannerPlusReviewerWorkflow();
  } else {
    workflowGuidance = getPlannerSoloWorkflow();
  }

  // Build team availability section
  const availabilitySection = getTeamAvailabilitySection(availableMembers ?? teamRoles);

  return `
## Planner Workflow

You are the team coordinator and the **single point of contact** for the user.
${classificationNote}

${availabilitySection}

${workflowGuidance}

**Core Responsibilities:**
- **User Communication**: You are the ONLY role that communicates with the user. All responses to the user come through you.
- **Task Decomposition**: Break complex tasks into clear, actionable work items before delegating.
- **Quality Accountability**: You are ultimately accountable for all work. If the user's requirements are not met, hand work back to the builder for rework.
- **Backlog Management**: You have exclusive access to manage the backlog. Prioritize and assign tasks.

**Delegation Guidelines:**
- Provide clear, specific instructions when delegating to team members
- Include acceptance criteria so team members know when they're done
- Review all completed work before delivering to the user
- If work doesn't meet requirements, send it back with specific feedback

**Handoff Rules:**
- **To delegate implementation** → Hand off to \`builder\` with clear requirements
- **To request review** → Hand off to \`reviewer\` with context about what to check
- **To deliver to user** → Hand off to \`user\` with a summary of what was done
- **For rework** → Hand off back to \`builder\` with specific feedback on what needs to change

**When you receive work back from team members:**
1. Review the completed work against the original user request
2. If requirements are met → deliver to user
3. If requirements are NOT met → hand back to the appropriate team member with specific feedback
`;
}

function getTeamAvailabilitySection(availableMembers: string[]): string {
  const nonPlannerMembers = availableMembers.filter((r) => r.toLowerCase() !== 'planner');

  if (nonPlannerMembers.length === 0) {
    return `**Team Availability:** You are working solo. Handle implementation and review yourself.`;
  }

  return `**Team Availability:** ${nonPlannerMembers.join(', ')} available.`;
}

function getFullTeamWorkflow(): string {
  return `**Current Workflow: Full Team (Planner + Builder + Reviewer)**

\`\`\`
User → Planner → Builder → Reviewer → Planner → User
\`\`\`

1. Receive task from user and decompose it
2. Delegate implementation to **builder** with clear requirements
3. Builder completes work and hands off to **reviewer**
4. Reviewer validates and hands off back to **planner**
5. You review the final result and deliver to **user**`;
}

function getPlannerPlusBuilderWorkflow(): string {
  return `**Current Workflow: Planner + Builder (no reviewer)**

\`\`\`
User → Planner → Builder → Planner(reviews) → User
\`\`\`

1. Receive task from user and decompose it
2. Delegate implementation to **builder** with clear requirements
3. Builder completes work and hands off back to **planner**
4. You review the work yourself (acting as reviewer)
5. If acceptable, deliver to **user**. If not, hand back to **builder** with feedback.`;
}

function getPlannerPlusReviewerWorkflow(): string {
  return `**Current Workflow: Planner + Reviewer (no builder)**

\`\`\`
User → Planner → Reviewer(implements) → Planner → User
\`\`\`

1. Receive task from user and decompose it
2. Delegate implementation to **reviewer** (who acts as builder)
3. Reviewer completes work and hands off back to **planner**
4. You review the final result and deliver to **user**`;
}

function getPlannerSoloWorkflow(): string {
  return `**Current Workflow: Planner Solo**

\`\`\`
User → Planner(implements + reviews) → User
\`\`\`

1. Receive task from user
2. Implement the solution yourself
3. Review your own work for quality
4. Deliver to **user**`;
}
