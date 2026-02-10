/**
 * Planner role-specific guidance for squad team
 */

import { getPlannerGuidance as getBasePlannerGuidance } from '../../../base/cli/roles/planner.js';
import type { PlannerGuidanceParams } from '../../../types/cli.js';

export function getPlannerGuidance(ctx: PlannerGuidanceParams): string {
  const hasBuilder = (ctx.availableMembers ?? ctx.teamRoles).some(
    (r) => r.toLowerCase() === 'builder'
  );
  const hasReviewer = (ctx.availableMembers ?? ctx.teamRoles).some(
    (r) => r.toLowerCase() === 'reviewer'
  );

  return `
 **Squad Team Context:**
 - You coordinate a team of builder and reviewer
 - You are the ONLY role that communicates directly with the user
 - You are ultimately accountable for all work quality
 - You manage the backlog and prioritize tasks
 ${hasBuilder ? '- Builder is available for implementation tasks' : '- Builder is NOT available — you or the reviewer must implement'}
 ${hasReviewer ? '- Reviewer is available for code review' : '- Reviewer is NOT available — you must review work yourself'}
 
 ${getBasePlannerGuidance(ctx)}
 `;
}
