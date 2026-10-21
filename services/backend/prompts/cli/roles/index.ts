/**
 * Role-specific guidance aggregator for agent initialization prompts.
 */

// The role-module imports mirror fromContext.ts by design; both dispatch tables stay local.
// fallow-ignore-next-line code-duplication
import { getArchitectGuidance } from './architect';
import { getBuilderGuidance } from './builder';
import { getGameAssetDesignerGuidance } from './game-asset-designer';
import { getPlannerGuidance } from './planner';
import { getResearcherGuidance } from './researcher';
import { getReviewerGuidance } from './reviewer';
import { getTriageGuidance } from './triage';
import { getUiuxEngineerGuidance } from './uiux-engineer';
import { getVerifierGuidance } from './verifier';

type RoleSpecificGuidanceParams = {
  role: string;
  teamRoles: string[];
  isEntryPoint: boolean;
  convexUrl: string;
  chatroomId?: string | undefined;
  nativeIntegration?: boolean | undefined;
  codeChangesTarget: string;
  questionTarget?: string | undefined;
  /** Role the specialist guidance hands off to (from the team contract). */
  recipientRole: string;
};

const ROLE_GUIDANCE_BY_ROLE: Record<string, (params: RoleSpecificGuidanceParams) => string> = {
  planner: getPlannerGuidance,
  builder: getBuilderGuidance,
  architect: ({ recipientRole, nativeIntegration }) =>
    getArchitectGuidance({ recipientRole, nativeIntegration }),
  researcher: ({ recipientRole, nativeIntegration }) =>
    getResearcherGuidance({ recipientRole, nativeIntegration }),
  reviewer: ({ recipientRole, nativeIntegration }) =>
    getReviewerGuidance({ recipientRole, nativeIntegration }),
  'game-asset-designer': ({ recipientRole, nativeIntegration }) =>
    getGameAssetDesignerGuidance({ recipientRole, nativeIntegration }),
  triage: ({ recipientRole, nativeIntegration }) =>
    getTriageGuidance({ recipientRole, nativeIntegration }),
  verifier: ({ recipientRole, nativeIntegration }) =>
    getVerifierGuidance({ recipientRole, nativeIntegration }),
  'uiux-engineer': ({ recipientRole, nativeIntegration }) =>
    getUiuxEngineerGuidance({ recipientRole, nativeIntegration }),
};

/**
 * Generate role-specific guidance based on the role
 */
export function getRoleSpecificGuidance(
  role: string,
  teamRoles: string[],
  isEntryPoint: boolean,
  convexUrl: string,
  recipientRole: string
): string {
  const normalizedRole = role.toLowerCase();
  return (
    ROLE_GUIDANCE_BY_ROLE[normalizedRole]?.({
      role,
      teamRoles,
      isEntryPoint,
      convexUrl,
      recipientRole,
      // The contract recipient is also the builder's post-code-change target.
      codeChangesTarget: recipientRole,
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
