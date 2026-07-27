/**
 * Handoff template: Duo builder → planner (work complete / blocked).
 *
 * Every section is required — write Not Applicable when a section does not apply. The handback captures not just
 * what changed but the reasoning behind it:
 *  1. Template disclosure confirmation — builder attests they saw this template
 *     at task start before implementing (soft verification for debugging).
 *  2. Proof of principles — how the work adhered to organization/maintainability
 *     and static evaluability/provability principles.
 *  3. Proof of completion — evidence the delegation goal was met (files changed).
 */

import type { RoleGuidanceCommandParams } from '../../../cli/role-guidance/command';
import { getHandoffRecipientVisibilityCallout } from '../../../native/handoff-visibility';
import { CODE_CHANGE_VERIFICATION_CONFIRMATION } from '../../../utils/code-change-verification';
import { getDelegationBriefDisclosureBlock } from '../../../utils/delegation-disclosure';
import { getFileReferenceProofOfCompletionExample } from '../../../utils/file-reference-guidance';
import { getHandoffQualityPrinciplesSectionBlock } from '../../../utils/handoff-quality-principles';
import { getHandoffReportTemplateIntro } from '../../../utils/handoff-section-guidance';
import { getRoleGuidanceDisclosureBlock } from '../../../utils/role-guidance-disclosure';

/**
 * Returns the markdown handoff template the builder uses when returning work
 * to the planner.
 */
export function getBuilderToPlannerHandoffTemplate(
  roleGuidanceContext?: RoleGuidanceCommandParams
): string {
  return `${getHandoffRecipientVisibilityCallout('planner')}

${getHandoffReportTemplateIntro('Handoff Template (Builder → Planner)')}

\`\`\`markdown
## Summary
<what was implemented or attempted, in plain terms>

## Template Disclosure Confirmation
- [ ] I confirm that I have seen this template at the start of this task, before implementing or modifying any code
${getRoleGuidanceDisclosureBlock(roleGuidanceContext)}

${getHandoffQualityPrinciplesSectionBlock()}

## Proof of Completion
${getDelegationBriefDisclosureBlock()}
${getFileReferenceProofOfCompletionExample()}
<evidence the goal was met — list every file you modified>

## Code Change Verification
${CODE_CHANGE_VERIFICATION_CONFIRMATION}

## Blockers / questions
<!-- REQUIRED. List blockers, or write "Not Applicable". Do not omit this section. -->
<anything needing planner decision>

## Notes for review
<!-- REQUIRED. List review notes, or write "Not Applicable". Do not omit this section. -->
<specific areas for planner to check>
\`\`\``;
}
