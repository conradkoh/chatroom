/**
 * Planner role-specific guidance for duo team.
 *
 * In the duo team, the planner is the entry point and communicates
 * with the user. The planner delegates implementation to the builder and
 * delivers the final result back to the user.
 *
 * Team composition is fixed: planner + builder (no reviewer).
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
  getPlannerPlusBuilderWorkflow,
  getPlannerSoloWorkflow,
} from '../../../cli/sections';
import { getSessionContinuityLine } from '../../../native/session-continuity';
import type { PlannerGuidanceParams } from '../../../types/cli';

/** Duo team always has a builder and no reviewer (fixed team composition) */
const DUO_TEAM_CONFIG = { hasBuilder: true, hasReviewer: false } as const;

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

  // Workflow diagram adapts to current availability
  const workflowGuidance = builderOnline
    ? getPlannerPlusBuilderWorkflow(nativeIntegration)
    : getPlannerSoloWorkflow(nativeIntegration);

  return `## Planner Workflow

${getSessionContinuityLine(nativeIntegration)}

You are the team coordinator and the **single point of contact** for the user.
${classificationNote}

**Duo Team Context:**
- You are the entry point — you communicate directly with the user
- You coordinate with the builder for implementation tasks
- You are ultimately accountable for all work quality
- Builder may go offline at any time — if unavailable, implement changes yourself
- After reviewing builder output, deliver results to the user
- **Only you can hand off to \`user\`**

${getTeamAvailabilitySection(members)}

${workflowGuidance}

${getCoreResponsibilitiesSection(DUO_TEAM_CONFIG)}

${getDelegationAndDecompositionSection(DUO_TEAM_CONFIG)}

${getDelegationGuidelinesSection(DUO_TEAM_CONFIG, {
  cliEnvPrefix,
  chatroomId,
  role,
  nativeIntegration,
})}

${getHandoffRulesSection(DUO_TEAM_CONFIG, nativeIntegration)}

${getWhenWorkComesBackSection(DUO_TEAM_CONFIG)}`;
}
