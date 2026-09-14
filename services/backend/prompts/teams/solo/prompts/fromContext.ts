/**
 * SelectorContext adapters for solo team role guidance.
 *
 * These adapters bridge the new SelectorContext type to the solo-specific
 * role guidance function.
 */

import { getSoloGuidance } from './solo';
import type { PlannerGuidanceParams } from '../../../types/cli';
import type { SelectorContext } from '../../../types/sections';

// =============================================================================
// Parameter Converter
// =============================================================================

export function toSoloParams(ctx: SelectorContext): PlannerGuidanceParams {
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
 * Get solo agent guidance from a SelectorContext.
 */
export function getSoloGuidanceFromContext(ctx: SelectorContext): string {
  return getSoloGuidance(toSoloParams(ctx));
}

/**
 * Get solo team role guidance from a SelectorContext.
 *
 * Dispatches to the solo role function. Returns null for roles not
 * handled by the solo team.
 */
export function getSoloRoleGuidanceFromContext(ctx: SelectorContext): string | null {
  const normalizedRole = ctx.role.toLowerCase();

  if (normalizedRole === 'solo') {
    return getSoloGuidanceFromContext(ctx);
  }

  return null;
}
