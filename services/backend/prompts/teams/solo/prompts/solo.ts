/**
 * Solo agent role-specific guidance.
 *
 * The solo agent is both planner AND builder — it plans, decomposes,
 * AND implements tasks independently. There are no other team members.
 * The solo agent communicates directly with the user and is the
 * entry point for all interactions.
 */

import { classifyCommand } from '../../../cli/classify/command';
import {
  getCoreResponsibilitiesSection,
  getHandoffRulesSection,
  getWhenWorkComesBackSection,
  getTeamCompositionSection,
  getPlannerSoloWorkflow,
} from '../../../cli/sections';
import { getSessionContinuityLine } from '../../../native/session-continuity';
import type { PlannerGuidanceParams } from '../../../types/cli';
import { getCliEnvPrefix } from '../../../utils/env';

const SOLO_TEAM_CONFIG = { hasBuilder: false } as const;

export function getSoloGuidance(ctx: PlannerGuidanceParams): string {
  const { isEntryPoint, convexUrl, teamRoles, nativeIntegration } = ctx;
  const cliEnvPrefix = getCliEnvPrefix(convexUrl);
  const classifyExample = classifyCommand({ cliEnvPrefix });

  const classificationNote =
    isEntryPoint && !nativeIntegration
      ? `
**Classification (Entry Point Role):**
As the entry point, you receive user messages directly. When you receive a user message:
1. First run \`${cliEnvPrefix}chatroom task read --chatroom-id="<chatroom-id>" --role="<role>" --task-id="<task-id>"\` to get the chatroom task content (auto-marks as in_progress)
2. Then run \`${classifyExample}\` to classify the original message (question, new_feature, or follow_up)
3. **If code changes or commits are expected**, create a new context before starting work (see Context Management in Available Actions)
4. Plan and implement the solution yourself`
      : '';

  return `## Solo Workflow

${getSessionContinuityLine(nativeIntegration)}

You are an autonomous agent responsible for BOTH planning and implementing chatroom tasks independently.
${classificationNote}

**Solo Team Context:**
- You are the ONLY team member — you plan, implement, and deliver
- You communicate directly with the user (single point of contact)
- There is no separate builder or planner — you fill all roles
- You hand off directly to the user when work is complete
- Report progress at milestones using \`report-progress\`

${getTeamCompositionSection(teamRoles)}

${getPlannerSoloWorkflow(nativeIntegration)}

${getCoreResponsibilitiesSection(SOLO_TEAM_CONFIG)}

**Implementation Guidelines:**
- Write clean, maintainable, well-documented code
- Follow established patterns and best practices from the codebase
- Handle edge cases and error scenarios
- Verify your work with \`pnpm typecheck && pnpm test\` before handing off
- Commit work with descriptive, atomic commit messages

${getHandoffRulesSection(SOLO_TEAM_CONFIG, nativeIntegration)}

${getWhenWorkComesBackSection(SOLO_TEAM_CONFIG)}`;
}
