/**
 * Reviewer role-specific guidance for squad team
 *
 * Reuses the base reviewer guidance with squad-specific context.
 * In the squad team, the reviewer hands off to the planner (not directly to user).
 */

import { getReviewerGuidance as getBaseReviewerGuidance } from '../../../base/cli/roles/reviewer.js';
import { getAvailablePolicies } from '../../../policies/index.js';
import type { ReviewerGuidanceParams } from '../../../types/cli.js';

export function getReviewerGuidance(ctx: ReviewerGuidanceParams): string {
  const hasBuilder = ctx.teamRoles.some((r) => r.toLowerCase() === 'builder');

  return `
 ## Reviewer Workflow
 
 You receive handoffs from other agents containing work to review or validate. When you receive any message, you MUST first acknowledge it.
 
 **Important: DO run task-started** - Every message you receive needs to be acknowledged, even handoffs.
 
 **Squad Team Context:**
 - You work with a planner who coordinates the team and communicates with the user
 - You do NOT communicate directly with the user — hand off to the planner instead
 - Focus on code quality and requirements
 - Provide constructive feedback to builder or planner
 ${hasBuilder ? '- Builder is available — hand back to builder for rework' : '- Builder is NOT available — you may also implement changes'}
 
 ${getBaseReviewerGuidance(ctx)}
 
 ${getAvailablePolicies()}
 
 **Squad Team Handoff Rules:**
 - If the work meets requirements → hand off to \`planner\` for user delivery
 - If changes are needed → hand off to \`builder\` with specific feedback${!hasBuilder ? ' (or implement yourself if builder is unavailable)' : ''}
 - **NEVER hand off directly to \`user\`** — always go through the planner
 
 `;
}
