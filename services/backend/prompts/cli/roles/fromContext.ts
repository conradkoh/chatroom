/**
 * SelectorContext adapters for base role guidance functions.
 *
 * These adapters bridge the new SelectorContext type to the existing
 * role-specific parameter types, enabling gradual migration.
 *
 * Phase 1.2 of the prompt engineering architecture refactor.
 * See docs/prompt-engineering/design.md
 */

import { getBuilderGuidance } from './builder';
import { getPlannerGuidance } from './planner';
import { getReviewerGuidance } from './reviewer';
import type {
  BuilderGuidanceParams,
  PlannerGuidanceParams,
  ReviewerGuidanceParams,
} from '../../types/cli';
import type { SelectorContext } from '../../types/sections';

// =============================================================================
// Parameter Converters
// =============================================================================

/**
 * Convert SelectorContext to BuilderGuidanceParams.
 *
 * The base builder doesn't apply team-specific overrides like questionTarget;
 * that's the team wrapper's job. This gives the "vanilla" base params.
 */
export function toBuilderParams(ctx: SelectorContext): BuilderGuidanceParams {
  return {
    role: ctx.role,
    teamRoles: ctx.teamRoles,
    isEntryPoint: ctx.isEntryPoint,
    convexUrl: ctx.convexUrl,
  };
}

/**
 * Convert SelectorContext to ReviewerGuidanceParams.
 *
 * The base reviewer doesn't apply team-specific overrides like approvalTarget;
 * that's the team wrapper's job. This gives the "vanilla" base params.
 */
export function toReviewerParams(ctx: SelectorContext): ReviewerGuidanceParams {
  return {
    role: ctx.role,
    teamRoles: ctx.teamRoles,
    isEntryPoint: ctx.isEntryPoint,
    convexUrl: ctx.convexUrl,
  };
}

/**
 * Convert SelectorContext to PlannerGuidanceParams.
 */
export function toPlannerParams(ctx: SelectorContext): PlannerGuidanceParams {
  return {
    role: ctx.role,
    teamRoles: ctx.teamRoles,
    isEntryPoint: ctx.isEntryPoint,
    convexUrl: ctx.convexUrl,
    chatroomId: ctx.chatroomId,
  };
}

// =============================================================================
// Context-based Entry Points
// =============================================================================

/**
 * Get base builder guidance from a SelectorContext.
 */
export function getBaseBuilderGuidanceFromContext(ctx: SelectorContext): string {
  return getBuilderGuidance(toBuilderParams(ctx));
}

/**
 * Get base reviewer guidance from a SelectorContext.
 */
export function getBaseReviewerGuidanceFromContext(ctx: SelectorContext): string {
  return getReviewerGuidance(toReviewerParams(ctx));
}

/**
 * Get base planner guidance from a SelectorContext.
 */
export function getBasePlannerGuidanceFromContext(ctx: SelectorContext): string {
  return getPlannerGuidance(toPlannerParams(ctx));
}

/**
 * Get role-specific base guidance from a SelectorContext.
 *
 * Dispatches to the appropriate role function based on ctx.role.
 * Returns empty string for unknown roles.
 */
export function getBaseRoleGuidanceFromContext(ctx: SelectorContext): string {
  const normalizedRole = ctx.role.toLowerCase();

  if (normalizedRole === 'planner') {
    return getBasePlannerGuidanceFromContext(ctx);
  }
  if (normalizedRole === 'builder') {
    return getBaseBuilderGuidanceFromContext(ctx);
  }
  if (normalizedRole === 'reviewer') {
    return getBaseReviewerGuidanceFromContext(ctx);
  }

  return '';
}
