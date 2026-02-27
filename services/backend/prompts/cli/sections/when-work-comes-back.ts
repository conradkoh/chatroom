/**
 * "When you receive work back" section for the planner role.
 *
 * Describes what the planner should do when reviewing work returned
 * from a team member, with metarole-aware language for step 3
 * (rework path) based on whether a builder is available.
 */

import type { TeamCompositionConfig } from './team-composition';

/**
 * Generate the "When you receive work back" section.
 */
export function getWhenWorkComesBackSection(
  config: Pick<TeamCompositionConfig, 'hasBuilder'>
): string {
  const reworkLine = config.hasBuilder
    ? '3. If requirements are NOT met → hand back to `builder` for rework'
    : '3. If requirements are NOT met → revise your own implementation and re-validate';

  return `**When you receive work back from team members:**
1. Review the completed work against the original user request
2. If requirements are met → deliver to \`user\`
${reworkLine}
4. **NEVER hand off back to the sender** — do not acknowledge, thank, or loop back`;
}
