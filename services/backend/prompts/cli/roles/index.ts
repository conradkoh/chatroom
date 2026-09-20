/**
 * Role-specific guidance aggregator for agent initialization prompts.
 */

import { getBuilderGuidance } from './builder';
import { getPlannerGuidance } from './planner';
import { getSpecialistGuidance } from './specialists';

type RoleSpecificGuidanceParams = {
  role: string;
  teamRoles: string[];
  isEntryPoint: boolean;
  convexUrl: string;
  chatroomId?: string | undefined;
  nativeIntegration?: boolean | undefined;
  codeChangesTarget?: string | undefined;
  questionTarget?: string | undefined;
  entryPointRole?: string | undefined;
};

const ROLE_GUIDANCE_BY_ROLE: Record<string, (params: RoleSpecificGuidanceParams) => string> = {
  planner: getPlannerGuidance,
  builder: getBuilderGuidance,
  architect: ({ role, entryPointRole }) => getSpecialistGuidance({ role, entryPointRole }),
  'uiux-engineer': ({ role, entryPointRole }) => getSpecialistGuidance({ role, entryPointRole }),
};

/**
 * Generate role-specific guidance based on the role
 */
export function getRoleSpecificGuidance(
  role: string,
  teamRoles: string[],
  isEntryPoint: boolean,
  convexUrl: string,
  entryPointRole?: string
): string {
  const normalizedRole = role.toLowerCase();
  return (
    ROLE_GUIDANCE_BY_ROLE[normalizedRole]?.({
      role,
      teamRoles,
      isEntryPoint,
      convexUrl,
      entryPointRole,
    }) ?? ''
  );
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
