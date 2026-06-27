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

import { getSessionContinuityLine } from '../../native/session-continuity';
import type { PlannerGuidanceParams } from '../../types/cli';
import { getCliEnvPrefix } from '../../utils/env';
import {
  getCoreResponsibilitiesSection,
  getDelegationAndDecompositionSection,
  getDelegationGuidelinesSection,
  getHandoffRulesSection,
  getWhenWorkComesBackSection,
  getTeamCompositionSection,
  getOperatingModelSection,
} from '../sections';

/**
 * Generate planner-specific guidance.
 *
 * Derives team composition from `teamRoles`
 * so that dynamic team state is reflected. Team-specific prompt files that know
 * their composition at compile time should use the section builders in
 * `../sections/` directly with their hardcoded team config.
 */
export function getPlannerGuidance(params: PlannerGuidanceParams): string {
  const { convexUrl, teamRoles, chatroomId, role, nativeIntegration } = params;
  const cliEnvPrefix = getCliEnvPrefix(convexUrl);

  // teamRoles is configured composition — not live agent presence
  const members = teamRoles;
  const hasBuilder = members.some((r) => r.toLowerCase() === 'builder');
  const teamConfig = { hasBuilder };

  return `## Planner Operating Model

${getSessionContinuityLine(nativeIntegration)}

You are the team coordinator and the **single point of contact** for the user.

${getTeamCompositionSection(members)}

${getOperatingModelSection(teamConfig, nativeIntegration)}

${getCoreResponsibilitiesSection(teamConfig)}

${getDelegationAndDecompositionSection(teamConfig)}

${getDelegationGuidelinesSection(teamConfig, { cliEnvPrefix, chatroomId, role })}

${getHandoffRulesSection(teamConfig, nativeIntegration)}

${getWhenWorkComesBackSection(teamConfig)}`;
}
