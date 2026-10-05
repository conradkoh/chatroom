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
    ? '3. If requirements are NOT met (including partial work) → hand back to `builder` for rework'
    : '3. If requirements are NOT met (including partial work) → revise and re-validate';
  const implementerReview = config.hasBuilder
    ? 'Builder implementation defects return to the builder.'
    : 'Implementation defects return to solo implementation for rework.';

  const uiReview = `**UI/UX-directed work:** Treat an engineer handback as a design artifact, not completed implementation. Check existing DOM/style evidence, actual browser-rendered target markup and styles, viewport/state evidence, and the exact tests-first contract. If any are incomplete, return concrete missing evidence to the UI/UX engineer through the configured entry point. If complete, forward the design unchanged into implementation; never deliver the design handback to the user as a completed feature. ${implementerReview} Any design or test-contract deviation requires a revised engineer design through the entry point.`;

  return `**When you receive work back from team members:**
${uiReview}
1. Review the completed work against the original user request
2. If requirements are met → run proof of verification → deliver to \`user\`
${reworkLine}
4. **No ceremonial handoffs** — never hand back just to acknowledge, thank, or echo receipt. A handback to the sender is only valid when it carries concrete rework feedback (step 3). Handoffs to \`user\` are reserved for the final deliverable from the entry-point role.`;
}
