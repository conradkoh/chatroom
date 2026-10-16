/**
 * Handoff rules section for the planner role.
 */

import { getInterRoleHandoffRule, getUserHandoffVisibilityNote } from './inter-role-handoff-rule';
import type { TeamCompositionConfig } from './team-composition';
import { getHandoffContinuityRule } from '../../native/session-continuity';

function buildHandoffRuleLines(config: TeamCompositionConfig): string {
  const lines: string[] = [];
  if (config.hasBuilder) {
    lines.push('- **To delegate implementation** → Hand off to `builder` with clear requirements');
    lines.push(
      '- **For rework** → Hand off back to `builder` with specific feedback on what needs to change'
    );
  } else {
    lines.push(
      '- **To implement** → Work on the chatroom task directly (you are acting as implementer)'
    );
    lines.push('- **For rework** → Revise your implementation directly and re-validate');
  }
  lines.push(getInterRoleHandoffRule());
  lines.push(
    `- **When the work is complete and ready for the user** → Hand off to \`user\` with a complete, standalone summary\n  ⚠️ ${getUserHandoffVisibilityNote()}`
  );
  return lines.join('\n');
}

/**
 * Generate the Handoff Rules section.
 */
export function getHandoffRulesSection(
  config: TeamCompositionConfig,
  nativeIntegration?: boolean
): string {
  const continuityRule = getHandoffContinuityRule(nativeIntegration);
  const continuityBlock = continuityRule ? `${continuityRule}\n\n` : '';
  return `**Handoff Rules:**

${continuityBlock}${buildHandoffRuleLines(config)}`;
}
