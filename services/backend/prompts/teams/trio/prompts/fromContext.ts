/**
 * SelectorContext adapters for the trio team role guidance.
 *
 * Bridges the SelectorContext type to the trio coordinator, specifier, and
 * builder guidance functions. Specialists return null so the base dispatcher
 * keeps owning their guidance.
 */

import { getTrioBuilderGuidance } from './builder';
import { getCoordinatorGuidance } from './coordinator';
import { getSpecifierGuidance } from './specifier';
import type { BuilderGuidanceParams, PlannerGuidanceParams } from '../../../types/cli';
import type { SelectorContext } from '../../../types/sections';

// =============================================================================
// Parameter Converters
// =============================================================================

function toTrioBuilderParams(
  ctx: SelectorContext
): Omit<BuilderGuidanceParams, 'codeChangesTarget'> & { chatroomId?: string | undefined } {
  return {
    role: ctx.role,
    teamRoles: ctx.teamRoles,
    isEntryPoint: ctx.isEntryPoint,
    convexUrl: ctx.convexUrl,
    chatroomId: ctx.chatroomId,
    nativeIntegration: ctx.nativeIntegration,
  };
}

function toTrioPlannerParams(ctx: SelectorContext): PlannerGuidanceParams {
  return {
    role: ctx.role,
    teamRoles: ctx.teamRoles,
    isEntryPoint: ctx.isEntryPoint,
    convexUrl: ctx.convexUrl,
    chatroomId: ctx.chatroomId,
    nativeIntegration: ctx.nativeIntegration,
  };
}

// =============================================================================
// Context-based Entry Points
// =============================================================================

/**
 * Get trio team role guidance from a SelectorContext.
 *
 * Dispatches to the coordinator, specifier, or builder. Returns null for any
 * other role so specialists fall through to the base guidance.
 */
export function getTrioRoleGuidanceFromContext(ctx: SelectorContext): string | null {
  const normalizedRole = ctx.role.toLowerCase();

  if (normalizedRole === 'coordinator') {
    return getCoordinatorGuidance(toTrioPlannerParams(ctx));
  }
  if (normalizedRole === 'specifier') {
    return getSpecifierGuidance(toTrioPlannerParams(ctx));
  }
  if (normalizedRole === 'builder') {
    return getTrioBuilderGuidance(toTrioBuilderParams(ctx));
  }

  return null;
}
