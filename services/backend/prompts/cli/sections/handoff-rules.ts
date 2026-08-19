/**
 * Handoff rules section for the planner role.
 */

import type { TeamCompositionConfig } from './team-composition';
import { getHandoffContinuityRule } from '../../native/session-continuity';

function buildHandoffRuleLines(
  config: TeamCompositionConfig,
  plannerEnhancerActive?: boolean
): string {
  const lines: string[] = [];
  if (config.hasBuilder) {
    lines.push('- **To delegate implementation** → Hand off to `builder` with clear requirements');
    if (plannerEnhancerActive) {
      lines.push(
        '- **When enhancement is enabled** → On the initial user task, follow `<handoff-enhancer>` and forward the request before planning'
      );
    }
    lines.push(
      '- **For rework** → Hand off back to `builder` with specific feedback on what needs to change'
    );
  } else {
    lines.push(
      '- **To implement** → Work on the chatroom task directly (you are acting as implementer)'
    );
    lines.push('- **For rework** → Revise your implementation directly and re-validate');
  }
  lines.push(
    '- **To deliver to user** → Hand off to `user` with a complete, standalone summary\n  ⚠️ The user can ONLY see the handoff-to-user message — progress reports and all other messages are invisible to them. Write the handoff as a self-contained document: include all relevant context, results, and next steps without assuming the user read any prior conversation.'
  );
  return lines.join('\n');
}

/**
 * Generate the Handoff Rules section.
 */
export function getHandoffRulesSection(
  config: TeamCompositionConfig,
  nativeIntegration?: boolean,
  plannerEnhancerActive?: boolean
): string {
  const continuityRule = getHandoffContinuityRule(nativeIntegration);
  const continuityBlock = continuityRule ? `${continuityRule}\n\n` : '';
  return `**Handoff Rules:**

${continuityBlock}${buildHandoffRuleLines(config, plannerEnhancerActive)}`;
}
