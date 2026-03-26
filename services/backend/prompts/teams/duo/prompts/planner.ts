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
  getPlannerPlusBuilderWorkflow,
  getPlannerSoloWorkflow,
} from '../../../cli/sections';
import type { PlannerGuidanceParams } from '../../../types/cli';
import { getCliEnvPrefix } from '../../../utils/env';

/** Duo team always has a builder and no reviewer (fixed team composition) */
const DUO_TEAM_CONFIG = { hasBuilder: true, hasReviewer: false } as const;

export function getPlannerGuidance(ctx: PlannerGuidanceParams): string {
  const { isEntryPoint, convexUrl, teamRoles, availableMembers, chatroomId, role } = ctx;
  const cliEnvPrefix = getCliEnvPrefix(convexUrl);
  const classifyExample = classifyCommand({ cliEnvPrefix });

  // Dynamic: which members are currently online (builder may be offline)
  const members = availableMembers ?? teamRoles;
  const builderOnline = members.some((r) => r.toLowerCase() === 'builder');

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
  const workflowGuidance = builderOnline
    ? getPlannerPlusBuilderWorkflow()
    : getPlannerSoloWorkflow();

  return `## Planner Workflow

You are the team coordinator and the **single point of contact** for the user.
${classificationNote}

**Duo Team Context:**
- You are the entry point — you communicate directly with the user
- You coordinate with the builder for implementation tasks
- You are ultimately accountable for all work quality
- For any multi-step task (2+ steps), use the workflow skill to plan and track execution
${builderOnline ? '- Builder is available for implementation tasks' : '- Builder is NOT available — you must implement yourself'}
- After reviewing builder output, deliver results to the user
- **Only you can hand off to \`user\`**

${getTeamAvailabilitySection(members)}

${workflowGuidance}

${getCoreResponsibilitiesSection(DUO_TEAM_CONFIG)}

${getDelegationGuidelinesSection(DUO_TEAM_CONFIG, { cliEnvPrefix, chatroomId, role })}

${getHandoffRulesSection(DUO_TEAM_CONFIG)}

${getWhenWorkComesBackSection(DUO_TEAM_CONFIG)}`;
}
