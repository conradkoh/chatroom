/**
 * Role-specific guidance aggregator for agent initialization prompts.
 */

import { getBuilderGuidance } from './builder';
import { getPlannerGuidance } from './planner';
import { getReviewerGuidance } from './reviewer';

/**
 * Generate role-specific guidance based on the role
 */
export function getRoleSpecificGuidance(
  role: string,
  teamRoles: string[],
  isEntryPoint: boolean,
  convexUrl: string
): string {
  const normalizedRole = role.toLowerCase();

  if (normalizedRole === 'planner') {
    return getPlannerGuidance({ role, teamRoles, isEntryPoint, convexUrl });
  }

  if (normalizedRole === 'builder') {
    return getBuilderGuidance({ role, teamRoles, isEntryPoint, convexUrl });
  }

  if (normalizedRole === 'reviewer') {
    return getReviewerGuidance({ role, teamRoles, isEntryPoint, convexUrl });
  }

  return '';
}

// Re-export individual role functions for direct access
export { getBuilderGuidance, getPlannerGuidance, getReviewerGuidance };

// Re-export SelectorContext-based adapters (Phase 1.2)
export {
  getBaseRoleGuidanceFromContext,
  getBaseBuilderGuidanceFromContext,
  getBaseReviewerGuidanceFromContext,
  getBasePlannerGuidanceFromContext,
  toBuilderParams,
  toReviewerParams,
  toPlannerParams,
} from './fromContext';
