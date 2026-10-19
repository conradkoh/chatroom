/**
 * Key: `duo:planner->user@code` (bucket `code`; covers `code` and `code:enhanced`).
 * Planner → user final report. Body only: the pair resolver prepends the recipient callout and the title line.
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
export function getPlannerUserCodeTemplate(
  roleGuidanceContext?: RoleGuidanceCommandParams
): string {
  return `${getHandoffReportTemplateIntro()}

\`\`\`markdown
${getHandoffReportTemplateBody(roleGuidanceContext, { includeProofOfVerification: true })}
\`\`\``;
}
