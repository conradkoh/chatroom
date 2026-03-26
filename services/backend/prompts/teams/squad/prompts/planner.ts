/**
 * Planner role-specific guidance for squad team.
 *
 * In the squad team, the planner coordinates builder and reviewer.
 * The planner is the ONLY role that communicates directly with the user.
 *
 * Team composition is fixed: planner + builder + reviewer.
 * Static sections (handoff rules, delegation guidelines, responsibilities,
 * when-work-comes-back) use this hardcoded config — no runtime conditionals.
 * Dynamic sections (team availability, workflow diagram) adapt to which
 * members are currently online.
 */

import { classifyCommand } from '../../../cli/classify/command';
import {
  getCoreResponsibilitiesSection,
  getDelegationGuidelinesSection,
  getHandoffRulesSection,
  getWhenWorkComesBackSection,
  getTeamAvailabilitySection,
  getFullTeamWorkflow,
  getPlannerPlusBuilderWorkflow,
  getPlannerPlusReviewerWorkflow,
  getPlannerSoloWorkflow,
} from '../../../cli/sections';
import type { PlannerGuidanceParams } from '../../../types/cli';
import { getCliEnvPrefix } from '../../../utils/env';

/** Squad team always has a builder and reviewer (fixed team composition) */
const SQUAD_TEAM_CONFIG = { hasBuilder: true, hasReviewer: true } as const;

export function getPlannerGuidance(ctx: PlannerGuidanceParams): string {
  const { isEntryPoint, convexUrl, teamRoles, availableMembers } = ctx;
  const cliEnvPrefix = getCliEnvPrefix(convexUrl);
  const classifyExample = classifyCommand({ cliEnvPrefix });

  // Dynamic: which members are currently online
  const members = availableMembers ?? teamRoles;
  const builderOnline = members.some((r) => r.toLowerCase() === 'builder');
  const reviewerOnline = members.some((r) => r.toLowerCase() === 'reviewer');

  const classificationNote = isEntryPoint
    ? `
**Classification (Entry Point Role):**
As the entry point, you receive user messages directly. When you receive a user message:
1. First run \`${cliEnvPrefix}chatroom task read --chatroom-id="<chatroom-id>" --role="<role>" --task-id="<task-id>"\` to get the task content (auto-marks as in_progress)
2. Then run \`${classifyExample}\` to classify the original message (question, new_feature, or follow_up)
3. **If code changes or commits are expected**, create a new context before starting work (see Context Management in Available Actions)
4. Decompose the task into actionable work items if needed
5. Delegate to the appropriate team member or handle it yourself`
    : '';

  // Workflow diagram adapts to current availability
  let workflowGuidance: string;
  if (builderOnline && reviewerOnline) {
    workflowGuidance = getFullTeamWorkflow();
  } else if (builderOnline && !reviewerOnline) {
    workflowGuidance = getPlannerPlusBuilderWorkflow();
  } else if (!builderOnline && reviewerOnline) {
    workflowGuidance = getPlannerPlusReviewerWorkflow();
  } else {
    workflowGuidance = getPlannerSoloWorkflow();
  }

  return `## Planner Workflow

You are the team coordinator and the **single point of contact** for the user.
${classificationNote}

**Squad Team Context:**
- You coordinate a team of builder and reviewer
- You are the ONLY role that communicates directly with the user
- You are ultimately accountable for all work quality
- For any multi-step task (2+ steps), use the workflow skill to plan and track execution
${builderOnline ? '- Builder is available for implementation tasks' : '- Builder is NOT available — you or the reviewer must implement'}
${reviewerOnline ? '- Reviewer is available for code review' : '- Reviewer is NOT available — you must review work yourself'}

${getTeamAvailabilitySection(members)}

${workflowGuidance}

${getCoreResponsibilitiesSection(SQUAD_TEAM_CONFIG)}

${getDelegationGuidelinesSection(SQUAD_TEAM_CONFIG, { cliEnvPrefix })}

${getHandoffRulesSection(SQUAD_TEAM_CONFIG)}

${getWhenWorkComesBackSection(SQUAD_TEAM_CONFIG)}`;
}
