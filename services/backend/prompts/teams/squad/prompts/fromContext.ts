/**
 * SelectorContext adapters for squad team role guidance.
 *
 * These adapters bridge the new SelectorContext type to the existing
 * squad-specific role guidance functions.
 *
 * Phase 1.3 of the prompt engineering architecture refactor.
 * See docs/prompt-engineering/design.md
 */

import { getBuilderGuidance } from './builder.js';
import { getPlannerGuidance } from './planner.js';
import { getReviewerGuidance } from './reviewer.js';
import type {
  BuilderGuidanceParams,
  PlannerGuidanceParams,
  ReviewerGuidanceParams,
} from '../../../types/cli.js';
import type { SelectorContext } from '../../../types/sections.js';

// =============================================================================
// Parameter Converters
// =============================================================================

export function toSquadBuilderParams(ctx: SelectorContext): BuilderGuidanceParams {
  return {
    role: ctx.role,
    teamRoles: ctx.teamRoles,
    isEntryPoint: ctx.isEntryPoint,
    convexUrl: ctx.convexUrl,
    // Squad builder questionTarget is set inside the wrapper, not here
  };
}

export function toSquadReviewerParams(ctx: SelectorContext): ReviewerGuidanceParams {
  return {
    role: ctx.role,
    teamRoles: ctx.teamRoles,
    isEntryPoint: ctx.isEntryPoint,
    convexUrl: ctx.convexUrl,
    // Squad reviewer approvalTarget is set inside the wrapper, not here
  };
}

export function toSquadPlannerParams(ctx: SelectorContext): PlannerGuidanceParams {
  return {
    role: ctx.role,
    teamRoles: ctx.teamRoles,
    isEntryPoint: ctx.isEntryPoint,
    convexUrl: ctx.convexUrl,
    availableMembers: ctx.availableMembers,
  };
}

// =============================================================================
// Context-based Entry Points
// =============================================================================

/**
 * Get squad builder guidance from a SelectorContext.
 */
export function getSquadBuilderGuidanceFromContext(ctx: SelectorContext): string {
  return getBuilderGuidance(toSquadBuilderParams(ctx));
}

/**
 * Get squad reviewer guidance from a SelectorContext.
 */
export function getSquadReviewerGuidanceFromContext(ctx: SelectorContext): string {
  return getReviewerGuidance(toSquadReviewerParams(ctx));
}

/**
 * Get squad planner guidance from a SelectorContext.
 */
export function getSquadPlannerGuidanceFromContext(ctx: SelectorContext): string {
  return getPlannerGuidance(toSquadPlannerParams(ctx));
}

/**
 * Get squad team role guidance from a SelectorContext.
 *
 * Dispatches to the appropriate squad role function based on ctx.role.
 * Returns null for roles not handled by the squad team.
 */
export function getSquadRoleGuidanceFromContext(ctx: SelectorContext): string | null {
  const normalizedRole = ctx.role.toLowerCase();

  if (normalizedRole === 'planner') {
    return getSquadPlannerGuidanceFromContext(ctx);
  }
  if (normalizedRole === 'builder') {
    return getSquadBuilderGuidanceFromContext(ctx);
  }
  if (normalizedRole === 'reviewer') {
    return getSquadReviewerGuidanceFromContext(ctx);
  }

  return null;
}
