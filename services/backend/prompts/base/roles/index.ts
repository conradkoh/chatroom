/**
 * Role-specific guidance aggregator for agent initialization prompts.
 */

import { getBuilderGuidance } from './builder';
import { getReviewerGuidance } from './reviewer';

/**
 * Generate role-specific guidance based on the role
 */
export function getRoleSpecificGuidance(
  role: string,
  otherRoles: string[],
  isEntryPoint: boolean
): string {
  const normalizedRole = role.toLowerCase();

  if (normalizedRole === 'builder') {
    return getBuilderGuidance(isEntryPoint);
  }

  if (normalizedRole === 'reviewer') {
    return getReviewerGuidance(otherRoles);
  }

  return '';
}

// Re-export individual role functions for direct access
export { getBuilderGuidance, getReviewerGuidance };
