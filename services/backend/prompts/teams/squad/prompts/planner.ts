/**
 * Planner role-specific guidance for squad team.
 *
 * In the squad team, the planner coordinates builder and reviewer.
 * The planner is the ONLY role that communicates directly with the user.
 *
 * Team composition is fixed: planner + builder + reviewer.
 * Static sections (handoff rules, delegation guidelines, responsibilities,
 * when-work-comes-back) use this hardcoded config — no runtime conditionals.
 * Team availability and workflow sections use teamRoles configuration.
 */

import { getPlannerGuidanceContext } from '../../../cli/roles/planner-guidance-context';
import {
  getCoreResponsibilitiesSection,
  getDelegationAndDecompositionSection,
  getDelegationGuidelinesSection,
  getHandoffRulesSection,
  getWhenWorkComesBackSection,
  getTeamAvailabilitySection,
  getFullTeamWorkflow,
  getPlannerPlusBuilderWorkflow,
  getPlannerPlusReviewerWorkflow,
  getPlannerSoloWorkflow,
} from '../../../cli/sections';
import { getSessionContinuityLine } from '../../../native/session-continuity';
import type { PlannerGuidanceParams } from '../../../types/cli';

/** Squad team always has a builder and reviewer (fixed team composition) */
const SQUAD_TEAM_CONFIG = { hasBuilder: true, hasReviewer: true } as const;

export function getPlannerGuidance(ctx: PlannerGuidanceParams): string {
  const {
    nativeIntegration,
    classificationNote,
    members,
    builderOnline,
    cliEnvPrefix,
    chatroomId,
    role,
  } = getPlannerGuidanceContext(ctx);
  const reviewerOnline = members.some((r) => r.toLowerCase() === 'reviewer');

  // Workflow diagram adapts to current availability
  let workflowGuidance: string;
  if (builderOnline && reviewerOnline) {
    workflowGuidance = getFullTeamWorkflow(nativeIntegration);
  } else if (builderOnline && !reviewerOnline) {
    workflowGuidance = getPlannerPlusBuilderWorkflow(nativeIntegration);
  } else if (!builderOnline && reviewerOnline) {
    workflowGuidance = getPlannerPlusReviewerWorkflow(nativeIntegration);
  } else {
    workflowGuidance = getPlannerSoloWorkflow(nativeIntegration);
  }

  return `## Planner Workflow

${getSessionContinuityLine(nativeIntegration)}

You are the team coordinator and the **single point of contact** for the user.
${classificationNote}

**Squad Team Context:**
- You coordinate a team of builder and reviewer
- You are the ONLY role that communicates directly with the user
- You are ultimately accountable for all work quality
- Team members may go offline at any time — adapt by handling their responsibilities yourself if needed

${getTeamAvailabilitySection(members)}

${workflowGuidance}

${getCoreResponsibilitiesSection(SQUAD_TEAM_CONFIG)}

${getDelegationAndDecompositionSection(SQUAD_TEAM_CONFIG)}

${getDelegationGuidelinesSection(SQUAD_TEAM_CONFIG, {
  cliEnvPrefix,
  chatroomId,
  role,
  nativeIntegration,
})}

${getHandoffRulesSection(SQUAD_TEAM_CONFIG, nativeIntegration)}

${getWhenWorkComesBackSection(SQUAD_TEAM_CONFIG)}`;
}
