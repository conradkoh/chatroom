/**
 * Planner role-specific guidance for duo team.
 *
 * In the duo team, the planner is the entry point and communicates
 * with the user. The planner delegates implementation to the builder and
 * delivers the final result back to the user.
 *
 * Team composition is fixed: planner + builder.
 * Static sections (handoff rules, delegation guidelines, responsibilities,
 * when-work-comes-back) use this hardcoded config — no runtime conditionals.
 * Team composition and workflow sections use teamRoles configuration.
 */

import { getPlannerGuidanceContext } from '../../../cli/roles/planner-guidance-context';
import {
  getCoreResponsibilitiesSection,
  getDelegationAndDecompositionSection,
  getDelegationGuidelinesSection,
  getHandoffRulesSection,
  getWhenWorkComesBackSection,
  getTeamCompositionSection,
  getPlannerPlusBuilderOperatingModel,
} from '../../../cli/sections';
import { getSessionContinuityLine } from '../../../native/session-continuity';
import type { PlannerGuidanceParams } from '../../../types/cli';

const DUO_TEAM_CONFIG = { hasBuilder: true } as const;

export function getPlannerGuidance(ctx: PlannerGuidanceParams): string {
  const { nativeIntegration, members, cliEnvPrefix, chatroomId, role } =
    getPlannerGuidanceContext(ctx);

  const operatingModelGuidance = getPlannerPlusBuilderOperatingModel(nativeIntegration);

  return `## Planner Operating Model

${getSessionContinuityLine(nativeIntegration)}

You are the team coordinator and the **single point of contact** for the user.

**Duo Team Context:**
- You are the entry point — you communicate directly with the user
- You coordinate with the builder for implementation tasks
- You are ultimately accountable for all work quality
- Builder may go offline at any time — if unavailable when code work is needed, report the situation to the user
- After reviewing builder output, deliver results to the user
- **Only you can hand off to \`user\`**

${getTeamCompositionSection(members)}

${operatingModelGuidance}

${getCoreResponsibilitiesSection(DUO_TEAM_CONFIG)}

${getDelegationAndDecompositionSection(DUO_TEAM_CONFIG)}

${getDelegationGuidelinesSection(DUO_TEAM_CONFIG, {
  cliEnvPrefix,
  chatroomId,
  role,
})}

${getHandoffRulesSection(DUO_TEAM_CONFIG, nativeIntegration)}

${getWhenWorkComesBackSection(DUO_TEAM_CONFIG)}`;
}
