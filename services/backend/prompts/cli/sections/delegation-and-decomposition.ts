/**
 * Delegation and decomposition section for the planner role.
 *
 * High-level "why & when" companion to the detailed how-to in
 * delegation-guidelines.ts. Gated to multi-agent teams only
 * (hasBuilder) — solo agents get no delegation guidance.
 */

import type { TeamCompositionConfig } from './team-composition';

/**
 * Generate the Delegation and Decomposition section.
 *
 * Returns empty string when the planner works alone (no builder).
 */
export function getDelegationAndDecompositionSection(config: TeamCompositionConfig): string {
  if (!config.hasBuilder) {
    return '';
  }

  return `**Delegation & Decomposition:**

Break complex tasks into small, focused slices and delegate them one at a time using a **Delegation Brief** (see **Delegation Guidelines** below).`;
}
