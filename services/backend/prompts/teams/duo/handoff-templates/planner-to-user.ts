/**
 * Handoff template: Duo planner → user (final report).
 *
 * This is the most important template in the set: the planner is the single
 * point of contact for the user, and the user can ONLY see the final
 * handoff-to-user message. A high-quality report shapes the planner's goals
 * up-front, which is why this template is delivered with each task (see
 * prompts/cli/get-next-task/fullOutput.ts and native task delivery) rather
 * than baked into the static init/system prompt.
 *
 * Every section is required — write Not Applicable when a section does not apply. The report captures not just
 * what changed but the reasoning behind it:
 *  1. Overview (expanded by default) — Summary + What changed
 *  2. Proofs (collapsed) — Template disclosure, Proof of Planning, Proof of Principles (##),
 *     Proof of Completion (##), Backlog attestations, Code Change Verification
 *  3. Direction (collapsed) — What exists today, Key Technical Decisions, Tradeoffs, System Design
 *  4. Notes (collapsed)
 *  5. Action required (expanded by default) — Tech Debt, Unresolved Decisions, Manual steps
 */

import type { RoleGuidanceCommandParams } from '../../../cli/role-guidance/command';
import { getHandoffRecipientVisibilityCallout } from '../../../native/handoff-visibility';
import { getHandoffReportTemplateBody } from '../../../utils/handoff-report-template-body';
import { getHandoffReportTemplateIntro } from '../../../utils/handoff-section-guidance';

/**
 * Returns the markdown report template the planner uses when delivering the
 * final result to the user.
 */
export function getPlannerToUserReportTemplate(
  roleGuidanceContext?: RoleGuidanceCommandParams
): string {
  return `${getHandoffRecipientVisibilityCallout('user')}

${getHandoffReportTemplateIntro('Report Template (Planner → User)')}

\`\`\`markdown
${getHandoffReportTemplateBody(roleGuidanceContext)}
\`\`\``;
}
