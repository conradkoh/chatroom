/**
 * Reviewer role-specific guidance for pair team
 */

import { getReviewerGuidance as getBaseReviewerGuidance } from '../../../base/cli/roles/reviewer.js';
import { getAvailablePolicies } from '../../../policies/index.js';
import type { ReviewerGuidanceParams } from '../../../types/cli.js';

export function getReviewerGuidance(ctx: ReviewerGuidanceParams): string {
  return `
 **Pair Team Context:**
 - You work with a builder who implements code
 - Focus on code quality and requirements
 - Provide constructive feedback to builder
 - If the user's goal is met → hand off to user
 - If changes are needed → hand off to builder with specific feedback
 
 ${getBaseReviewerGuidance(ctx)}
 
 ${getAvailablePolicies()}
 `;
}
