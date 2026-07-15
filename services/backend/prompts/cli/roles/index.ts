/**
 * Role-specific guidance aggregator for agent initialization prompts.
 */

import { getBuilderGuidance } from './builder';
import { getPlannerGuidance } from './planner';
import { getWorkspaceAgentGuidance } from './workspace-agent';

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

  if (normalizedRole === 'workspace-agent') {
    return getWorkspaceAgentGuidance({ role, convexUrl });
  }

  return '';
}

// Re-export individual role functions for direct access
export { getBuilderGuidance, getPlannerGuidance };

// Re-export SelectorContext-based adapters (Phase 1.2)
export {
  getBaseRoleGuidanceFromContext,
  getBaseBuilderGuidanceFromContext,
  getBasePlannerGuidanceFromContext,
  toBuilderParams,
  toPlannerParams,
} from './fromContext';
