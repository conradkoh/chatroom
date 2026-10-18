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
import { getHandoffReportTemplateBody } from '../../../utils/handoff-report-template-body';
import { getHandoffReportTemplateIntro } from '../../../utils/handoff-section-guidance';

/**
 * Returns the markdown report template body the solo agent uses when delivering
 * the final result to the user.
 *
 * Body only: the pair resolver prepends the recipient callout and the
 * `solo` → `user` title line.
 */
export function getSoloToUserReportTemplate(
  roleGuidanceContext?: RoleGuidanceCommandParams
): string {
  return `${getHandoffReportTemplateIntro()}

\`\`\`markdown
${getHandoffReportTemplateBody(roleGuidanceContext, { includeProofOfVerification: true })}
\`\`\``;
}
