/**
 * Solo agent role-specific guidance.
 *
 * The solo agent is both planner AND builder — it plans, decomposes,
 * AND implements tasks independently. There are no other team members.
 * The solo agent communicates directly with the user and is the
 * entry point for all interactions.
 */

import { getPlannerGuidanceContext } from '../../../cli/roles/planner-guidance-context';
import {
  getCoreResponsibilitiesSection,
  getHandoffRulesSection,
  getWhenWorkComesBackSection,
  getTeamCompositionSection,
  getPlannerSoloOperatingModel,
  getProofOfVerificationSection,
} from '../../../cli/sections';
import { getSessionContinuityLine } from '../../../native/session-continuity';
import type { PlannerGuidanceParams } from '../../../types/cli';

const SOLO_TEAM_CONFIG = { hasBuilder: false } as const;

export function getSoloGuidance(ctx: PlannerGuidanceParams): string {
  const { teamRoles, nativeIntegration } = ctx;
  const { chatroomId, role, cliEnvPrefix } = getPlannerGuidanceContext(ctx);

  return `## Solo Operating Model

${getSessionContinuityLine(nativeIntegration)}

You are an autonomous agent responsible for BOTH planning and implementing chatroom tasks independently.

**Solo Team Context:**
- You are the ONLY team member — you plan, implement, and deliver
- You communicate directly with the user (single point of contact)
- There is no separate builder or planner — you fill all roles
- You hand off directly to the user when work is complete

${getTeamCompositionSection(teamRoles)}

${getPlannerSoloOperatingModel(nativeIntegration)}

${getCoreResponsibilitiesSection(SOLO_TEAM_CONFIG, { role: 'solo', teamId: 'solo' })}

**Implementation Guidelines:**
- For UI fixes or interface design, first state the observed problem, desired outcome, affected surfaces, constraints, and existing evidence. Hand off to the UI/UX engineer and wait for the complete rendered design and exact test contract before production edits; do not prescribe or substitute UI design.
- Confirm the handback includes inspected existing source/current rendered DOM and styles, exact target HTML/classes/style dependencies for relevant states/viewports, a browser-rendered target and preview location with actual screenshot or DOM/computed-style evidence, plus exact production UI tests and expected meaningful initial failure. Missing evidence or design choices are blockers to the engineer through the configured entry point.
- Write and run the engineer-specified production UI tests before production edits and record a meaningful design-relevant red result. Implement only after that, rerun to pass, and compare production DOM/styles with the rendered target. Never weaken tests or use only a mock of the proposal; route design or test-contract deviations through the engineer.
- Write clean, maintainable, well-documented code
- Follow established patterns and best practices from the codebase
- Handle edge cases and error scenarios
- Commit work with descriptive, atomic commit messages

${getHandoffRulesSection(SOLO_TEAM_CONFIG, nativeIntegration)}

${getWhenWorkComesBackSection(SOLO_TEAM_CONFIG)}

${getProofOfVerificationSection({ chatroomId, role, cliEnvPrefix })}`;
}
