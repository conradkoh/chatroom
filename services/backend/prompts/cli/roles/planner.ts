/**
 * Planner role-specific guidance for agent initialization prompts.
 *
 * The planner is the team coordinator: the single point of contact
 * for the user, responsible for task decomposition, delegation, and
 * ensuring work meets requirements before delivery.
 *
 * This module assembles the full planner prompt from composable section
 * builders (see ../sections/). Team-specific prompt files compose those
 * section builders directly with their hardcoded team config to avoid
 * runtime conditionals.
 */

import type { PlannerGuidanceParams } from '../../types/cli';
import { getCliEnvPrefix } from '../../utils/env';
import { taskStartedCommand } from '../task-started/command';
import {
  getCoreResponsibilitiesSection,
  getDelegationGuidelinesSection,
  getHandoffRulesSection,
  getWhenWorkComesBackSection,
  getTeamAvailabilitySection,
  getWorkflowSection,
} from '../sections';

/**
 * Generate planner-specific guidance.
 *
 * Derives team composition from `availableMembers` (falling back to `teamRoles`)
 * so that dynamic team state is reflected. Team-specific prompt files that know
 * their composition at compile time should use the section builders in
 * `../sections/` directly with their hardcoded team config.
 */
export function getPlannerGuidance(params: PlannerGuidanceParams): string {
  const { isEntryPoint, convexUrl, teamRoles, availableMembers } = params;
  const cliEnvPrefix = getCliEnvPrefix(convexUrl);
  const taskStartedExample = taskStartedCommand({ cliEnvPrefix });

  const members = availableMembers ?? teamRoles;
  const hasBuilder = members.some((r) => r.toLowerCase() === 'builder');
  const hasReviewer = members.some((r) => r.toLowerCase() === 'reviewer');
  const teamConfig = { hasBuilder, hasReviewer };

  const classificationNote = isEntryPoint
    ? `
**Classification (Entry Point Role):**
As the entry point, you receive user messages directly. When you receive a user message:
1. First run \`${cliEnvPrefix}chatroom task read --chatroom-id="<chatroom-id>" --role="<role>" --task-id="<task-id>"\` to get the task content (auto-marks as in_progress)
2. Then run \`${taskStartedExample}\` to classify the original message (question, new_feature, or follow_up)
3. **If code changes or commits are expected**, create a new context before starting work (see Context Management in Available Actions)
4. Decompose the task into actionable work items if needed
5. Delegate to the appropriate team member or handle it yourself`
    : '';

  return `## Planner Workflow

You are the team coordinator and the **single point of contact** for the user.
${classificationNote}

${getTeamAvailabilitySection(members)}

${getWorkflowSection(teamConfig)}

${getCoreResponsibilitiesSection(teamConfig)}

${getDelegationGuidelinesSection(teamConfig, { cliEnvPrefix })}

${getHandoffRulesSection(teamConfig)}

${getWhenWorkComesBackSection(teamConfig)}`;
}
