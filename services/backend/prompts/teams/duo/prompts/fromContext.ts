/**
 * SelectorContext adapters for duo team role guidance.
 *
 * These adapters bridge the new SelectorContext type to the existing
 * duo-specific role guidance functions.
 */

import { getBuilderGuidance } from './builder';
import { getPlannerGuidance } from './planner';
import type { BuilderGuidanceParams, PlannerGuidanceParams } from '../../../types/cli';
import type { SelectorContext } from '../../../types/sections';

// =============================================================================
// Parameter Converters
// =============================================================================

export function toDuoBuilderParams(ctx: SelectorContext): BuilderGuidanceParams {
  return {
    role: ctx.role,
    teamRoles: ctx.teamRoles,
    isEntryPoint: ctx.isEntryPoint,
    convexUrl: ctx.convexUrl,
  };
}

export function toDuoPlannerParams(ctx: SelectorContext): PlannerGuidanceParams {
  return {
    role: ctx.role,
    teamRoles: ctx.teamRoles,
    isEntryPoint: ctx.isEntryPoint,
    convexUrl: ctx.convexUrl,
  };
}

// =============================================================================
// Context-based Entry Points
// =============================================================================

/**
 * Get duo builder guidance from a SelectorContext.
 */
export function getDuoBuilderGuidanceFromContext(ctx: SelectorContext): string {
  return getBuilderGuidance(toDuoBuilderParams(ctx));
}

/**
 * Get duo planner guidance from a SelectorContext.
 */
export function getDuoPlannerGuidanceFromContext(ctx: SelectorContext): string {
  return getPlannerGuidance(toDuoPlannerParams(ctx));
}

/**
 * Get duo team role guidance from a SelectorContext.
 *
 * Dispatches to the appropriate duo role function based on ctx.role.
 * Returns null for roles not handled by the duo team.
 */
export function getDuoRoleGuidanceFromContext(ctx: SelectorContext): string | null {
  const normalizedRole = ctx.role.toLowerCase();

  if (normalizedRole === 'planner') {
    return getDuoPlannerGuidanceFromContext(ctx);
  }
  if (normalizedRole === 'builder') {
    return getDuoBuilderGuidanceFromContext(ctx);
  }

  return null;
}
