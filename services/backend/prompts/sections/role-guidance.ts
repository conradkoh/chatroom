/**
 * Role Guidance Section
 *
 * Team-aware role guidance (workflow, handoffs, best practices).
 * Wraps getRoleGuidanceFromContext into a PromptSection.
 */

import { buildSelectorContext, getRoleGuidanceFromContext } from '../generator.js';
import type { SelectorContext, PromptSection } from '../types/sections.js';
import { createSection } from '../types/sections.js';

/**
 * Generate the role guidance section using the SelectorContext dispatcher.
 *
 * This returns the full team-aware role guidance (squad builder, pair reviewer, etc.)
 * by delegating to getRoleGuidanceFromContext which follows the team → base fallback pattern.
 */
export function getRoleGuidanceSection(ctx: SelectorContext): PromptSection {
  const content = getRoleGuidanceFromContext(ctx);
  return createSection('role-guidance', 'knowledge', content);
}

/**
 * Re-export buildSelectorContext for convenience.
 */
export { buildSelectorContext, getRoleGuidanceFromContext };
