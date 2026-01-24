/**
 * Reviewer role-specific guidance for pair team
 */

import { getReviewerGuidance as getBaseReviewerGuidance } from '../../../base/cli/roles/reviewer.js';
import { getAvailablePolicies } from '../../../policies/index.js';

export function getReviewerGuidance(ctx: {
  role: string;
  teamRoles: string[];
  isEntryPoint: boolean;
  convexUrl?: string;
}): string {
  const hasBuilder = ctx.teamRoles.some((r) => r.toLowerCase() === 'builder');

  return `
 ## Reviewer Workflow
 
 You receive handoffs from other agents containing work to review or validate. When you receive any message, you MUST first acknowledge it.
 
 **Important: DO run task-started** - Every message you receive needs to be acknowledged, even handoffs.
 
 **Pair Team Context:**
 - You work with a builder who implements code
 - Focus on code quality and requirements
 - Provide constructive feedback to builder
 
 ${getBaseReviewerGuidance(ctx.teamRoles, ctx.convexUrl)}
 
 ${getAvailablePolicies()}
 
 **Pair Team Handoff Rules:**
 - If the user's goal is met → hand off to user
 - If changes are needed → hand off to builder with specific feedback
 
 ${hasBuilder ? '' : ''}`;
}
