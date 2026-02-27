/**
 * Planner role-specific guidance for duo team
 *
 * In the duo team, the planner is the entry point and communicates
 * with the user. The planner delegates implementation to the builder and
 * delivers the final result back to the user.
 */

import { getPlannerGuidance as getBasePlannerGuidance } from '../../../base/cli/roles/planner';
import type { PlannerGuidanceParams } from '../../../types/cli';

export function getPlannerGuidance(ctx: PlannerGuidanceParams): string {
  const hasBuilder = (ctx.availableMembers ?? ctx.teamRoles).some(
    (r) => r.toLowerCase() === 'builder'
  );

  return `
 **Duo Team Context:**
 - You are the entry point — you communicate directly with the user
 - You coordinate with the builder for implementation tasks
 - You are ultimately accountable for all work quality
 ${hasBuilder ? '- Builder is available for implementation tasks' : '- Builder is NOT available — you must implement yourself'}
 - After reviewing builder output, deliver results to the user
 - **Only you can hand off to \`user\`**
 
 ${getBasePlannerGuidance(ctx)}
 `;
}
