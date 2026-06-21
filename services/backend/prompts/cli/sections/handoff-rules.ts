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
import { getHandoffContinuityRule } from '../../native/session-continuity.js';

function buildHandoffRuleLines(config: TeamCompositionConfig): string {
  return [
    config.hasBuilder
      ? '- **To delegate implementation** → Hand off to `builder` with clear requirements'
      : '- **To implement** → Work on the chatroom task directly (you are acting as implementer)',
    ...(config.hasReviewer
      ? ['- **To request review** → Hand off to `reviewer` with context about what to check']
      : []),
    '- **To deliver to user** → Hand off to `user` with a complete, standalone summary\n  ⚠️ The user can ONLY see the handoff-to-user message — progress reports and all other messages are invisible to them. Write the handoff as a self-contained document: include all relevant context, results, and next steps without assuming the user read any prior conversation.',
    config.hasBuilder
      ? '- **For rework** → Hand off back to `builder` with specific feedback on what needs to change'
      : '- **For rework** → Revise your implementation directly and re-validate',
  ].join('\n');
}

/**
 * Generate the Handoff Rules section.
 */
export function getHandoffRulesSection(
  config: TeamCompositionConfig,
  nativeIntegration?: boolean
): string {
  const continuityRule = getHandoffContinuityRule(nativeIntegration);
  return `**Handoff Rules:**

${continuityRule}

${buildHandoffRuleLines(config)}`;
}
