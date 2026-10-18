/**
 * Handoff template: Duo planner → user (final report).
 *
 * This is the most important template in the set: the planner is the single
 * point of contact for the user, and the user reads the handoff-to-user
 * message and any `notify-user` notices. A high-quality report shapes the planner's goals
 * up-front, which is why this template is delivered with each task (see
 * prompts/cli/get-next-task/fullOutput.ts and native task delivery) rather
 * than baked into the static init/system prompt.
 *
 * Every section is required — do not omit sections. The report captures not just
 * what changed but the reasoning behind it:
 *  1. Overview (expanded by default) — Summary + What changed
 *  2. Proofs (collapsed) — Template disclosure, Proof of Planning, Proof of Principles (##),
 *     Proof of Completion (##), Backlog attestations, Code Change Verification
 *  3. Direction (collapsed) — What exists today, Key Technical Decisions, Tradeoffs, System Design
 *  4. Notes (collapsed)
 *  5. Action required (expanded by default) — Tech Debt, Unresolved Decisions, Manual steps
 */

import type { RoleGuidanceCommandParams } from '../../../cli/role-guidance/command';
import { getHandoffReportTemplateBody } from '../../../utils/handoff-report-template-body';
import { getHandoffReportTemplateIntro } from '../../../utils/handoff-section-guidance';

/**
 * Returns the markdown report template body the planner uses when delivering
 * the final result to the user.
 *
 * Body only: the pair resolver prepends the recipient callout and the
 * `planner` → `user` title line.
 */
export function getPlannerToUserReportTemplate(
  roleGuidanceContext?: RoleGuidanceCommandParams
): string {
  return `${getHandoffReportTemplateIntro()}

\`\`\`markdown
${getHandoffReportTemplateBody(roleGuidanceContext, { includeProofOfVerification: true })}
\`\`\``;
}
