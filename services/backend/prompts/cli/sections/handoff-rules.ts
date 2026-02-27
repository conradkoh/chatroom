/**
 * Handoff rules section for the planner role.
 *
 * Uses an array-join approach to avoid blank lines when roles are absent,
 * and uses metarole-aware language so the planner always has actionable
 * instructions regardless of team composition.
 *
 * Design notes on the reviewer line:
 *   - hasBuilder && !hasReviewer (duo): planner self-reviews builder output;
 *     the workflow diagram already covers this. No reviewer handoff line needed.
 *   - !hasBuilder && !hasReviewer (solo): planner implements AND reviews.
 *     The implementation line already says "acting as implementer". The rework
 *     line covers re-validation. No separate reviewer line needed.
 *   - !hasBuilder && hasReviewer: planner implements, hands to reviewer for review.
 *   - hasBuilder && hasReviewer (full team): explicit reviewer handoff line.
 */

import type { TeamCompositionConfig } from './team-composition';

/**
 * Generate the Handoff Rules section.
 */
export function getHandoffRulesSection(config: TeamCompositionConfig): string {
  const lines = [
    config.hasBuilder
      ? '- **To delegate implementation** → Hand off to `builder` with clear requirements'
      : '- **To implement** → Work on the task directly (you are acting as implementer)',
    ...(config.hasReviewer
      ? ['- **To request review** → Hand off to `reviewer` with context about what to check']
      : []), // No reviewer line for duo or solo — the workflow diagram covers self-review
    '- **To deliver to user** → Hand off to `user` with a summary of what was done',
    config.hasBuilder
      ? '- **For rework** → Hand off back to `builder` with specific feedback on what needs to change'
      : '- **For rework** → Revise your implementation directly and re-validate',
  ].join('\n');

  return `**Handoff Rules:**
${lines}`;
}
