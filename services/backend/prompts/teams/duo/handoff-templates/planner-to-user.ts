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
 * Sections that do not apply may be omitted — the report captures not just
 * what changed but the reasoning behind it:
 *  1. Template disclosure confirmation — planner attests they saw this template
 *     at task start before planning or delegating (soft verification for debugging).
 *  2. What changed — high-level view since the user's message, with proof of
 *     principle and proof of completion as sub-sections.
 *  3. Backlog tasks implemented — backlog items addressed by this work.
 *  4. Backlog pending user review confirmation — attestation that implemented
 *     backlog items were moved to pending_user_review after verified end-to-end and a PR was raised.
 *  5. Key technical decisions, tradeoffs, tech debt, and system design.
 *  6. Unresolved decisions — open questions carried forward until the user resolves them.
 */

import type { RoleGuidanceCommandParams } from '../../../cli/role-guidance/command';
import { getHandoffRecipientVisibilityCallout } from '../../../native/handoff-visibility';
import { getHandoffReportTemplateBody } from '../../../utils/handoff-report-template-body';
import { getHandoffReportTemplateIntro } from '../../../utils/handoff-section-guidance';
import { getRoleGuidanceDisclosureBlock } from '../../../utils/role-guidance-disclosure';

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
${getHandoffReportTemplateBody()}
\`\`\``;
}
