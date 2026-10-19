/**
 * Key: `solo:solo->user@code` (bucket `code`; covers `code` and `code:enhanced`).
 * Solo → user final report. Body only: the pair resolver prepends the recipient callout and the title line.
 */

import type { RoleGuidanceCommandParams } from '../../../cli/role-guidance/command';
import { getHandoffReportTemplateBody } from '../../../utils/handoff-report-template-body';
import { getHandoffReportTemplateIntro } from '../../../utils/handoff-section-guidance';

/**
 * Returns the markdown report template body the solo agent uses when delivering
 * the final result to the user.
 *
 * Body only: the pair resolver prepends the recipient callout and the
 * `solo` → `user` title line.
 */
export function getSoloUserCodeTemplate(roleGuidanceContext?: RoleGuidanceCommandParams): string {
  return `${getHandoffReportTemplateIntro()}

\`\`\`markdown
${getHandoffReportTemplateBody(roleGuidanceContext, { includeProofOfVerification: true })}
\`\`\``;
}
