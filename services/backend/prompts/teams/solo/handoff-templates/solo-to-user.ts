/**
 * Handoff template: Solo → user (final report).
 *
 * The solo agent is both planner and builder — this template shapes goals
 * up-front (template disclosure + proof of planning) and verifies they were
 * met at handoff (context read attestation + proof of completion). Delivered
 * with each task rather than baked into the static init/system prompt.
 *
 * Every section is required — do not omit sections.
 */

import type { RoleGuidanceCommandParams } from '../../../cli/role-guidance/command';
import { getHandoffRecipientVisibilityCallout } from '../../../native/handoff-visibility';
import { getHandoffReportTemplateBody } from '../../../utils/handoff-report-template-body';
import { getHandoffReportTemplateIntro } from '../../../utils/handoff-section-guidance';

/**
 * Returns the markdown report template the solo agent uses when delivering
 * the final result to the user.
 */
export function getSoloToUserReportTemplate(
  roleGuidanceContext?: RoleGuidanceCommandParams
): string {
  return `${getHandoffRecipientVisibilityCallout('user')}

${getHandoffReportTemplateIntro('Report Template (Solo → User)')}

\`\`\`markdown
${getHandoffReportTemplateBody(roleGuidanceContext, { includeProofOfVerification: true })}
\`\`\``;
}
