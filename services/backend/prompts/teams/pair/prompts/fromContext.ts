/**
 * SelectorContext adapters for pair team role guidance.
 *
 * These adapters bridge the new SelectorContext type to the existing
 * pair-specific role guidance functions.
 *
 * Phase 1.3 of the prompt engineering architecture refactor.
 * See docs/prompt-engineering/design.md
 */

import { getBuilderGuidance } from './builder.js';
import { getReviewerGuidance } from './reviewer.js';
import type { BuilderGuidanceParams, ReviewerGuidanceParams } from '../../../types/cli.js';
import type { SelectorContext } from '../../../types/sections.js';

// =============================================================================
// Parameter Converters
// =============================================================================

export function toPairBuilderParams(ctx: SelectorContext): BuilderGuidanceParams {
  return {
    role: ctx.role,
    teamRoles: ctx.teamRoles,
    isEntryPoint: ctx.isEntryPoint,
    convexUrl: ctx.convexUrl,
    // Pair builder uses default questionTarget ('user')
  };
}

export function toPairReviewerParams(ctx: SelectorContext): ReviewerGuidanceParams {
  return {
    role: ctx.role,
    teamRoles: ctx.teamRoles,
    isEntryPoint: ctx.isEntryPoint,
    convexUrl: ctx.convexUrl,
    // Pair reviewer uses default approvalTarget ('user')
  };
}

// =============================================================================
// Context-based Entry Points
// =============================================================================

/**
 * Get pair builder guidance from a SelectorContext.
 */
export function getPairBuilderGuidanceFromContext(ctx: SelectorContext): string {
  return getBuilderGuidance(toPairBuilderParams(ctx));
}

/**
 * Get pair reviewer guidance from a SelectorContext.
 */
export function getPairReviewerGuidanceFromContext(ctx: SelectorContext): string {
  return getReviewerGuidance(toPairReviewerParams(ctx));
}

/**
 * Get pair team role guidance from a SelectorContext.
 *
 * Dispatches to the appropriate pair role function based on ctx.role.
 * Returns null for roles not handled by the pair team (e.g., planner).
 */
export function getPairRoleGuidanceFromContext(ctx: SelectorContext): string | null {
  const normalizedRole = ctx.role.toLowerCase();

  if (normalizedRole === 'builder') {
    return getPairBuilderGuidanceFromContext(ctx);
  }
  if (normalizedRole === 'reviewer') {
    return getPairReviewerGuidanceFromContext(ctx);
  }

  return null;
}
