/**
 * Solo agent role-specific guidance.
 *
 * The solo agent is both planner AND builder — it plans, decomposes,
 * AND implements tasks independently. There are no other team members.
 * The solo agent communicates directly with the user and is the
 * entry point for all interactions.
 */

import {
  getCoreResponsibilitiesSection,
  getHandoffRulesSection,
  getWhenWorkComesBackSection,
  getTeamCompositionSection,
  getPlannerSoloOperatingModel,
} from '../../../cli/sections';
import { getSessionContinuityLine } from '../../../native/session-continuity';
import type { PlannerGuidanceParams } from '../../../types/cli';

const SOLO_TEAM_CONFIG = { hasBuilder: false } as const;

export function getSoloGuidance(ctx: PlannerGuidanceParams): string {
  const { teamRoles, nativeIntegration } = ctx;

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

${getCoreResponsibilitiesSection(SOLO_TEAM_CONFIG)}

**Implementation Guidelines:**
- Write clean, maintainable, well-documented code
- Follow established patterns and best practices from the codebase
- Handle edge cases and error scenarios
- Commit work with descriptive, atomic commit messages

${getHandoffRulesSection(SOLO_TEAM_CONFIG, nativeIntegration)}

${getWhenWorkComesBackSection(SOLO_TEAM_CONFIG)}`;
}
