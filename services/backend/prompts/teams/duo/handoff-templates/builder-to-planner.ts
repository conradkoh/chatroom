/**
 * Handoff template: Duo builder → planner (work complete / blocked).
 *
 * Every section is mandatory — when one does not apply the builder writes
 * `Not Applicable` rather than omitting it. The handback captures not just
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
import {
  getHandoffQualityPrinciplesCommentBlock,
  PROOF_OF_PRINCIPLES_HEADING_H2,
} from '../../../utils/handoff-quality-principles';
import { getRoleGuidanceDisclosureBlock } from '../../../utils/role-guidance-disclosure';

/**
 * Returns the markdown handoff template the builder uses when returning work
 * to the planner.
 */
export function getBuilderToPlannerHandoffTemplate(
  roleGuidanceContext?: RoleGuidanceCommandParams
): string {
  return `${getHandoffRecipientVisibilityCallout('planner')}

**Handoff Template (Builder → Planner)** — paste into the handoff message. Fill in EVERY section below. If a section does not apply, write \`Not Applicable\` (do not delete the section):

\`\`\`markdown
## Summary
<what was implemented or attempted, in plain terms>

## Template Disclosure Confirmation
- [ ] I confirm that I have seen this template at the start of this task, before implementing or modifying any code
${getRoleGuidanceDisclosureBlock(roleGuidanceContext)}

${PROOF_OF_PRINCIPLES_HEADING_H2}
${getHandoffQualityPrinciplesCommentBlock()}
<how this work follows the principles above — localized changes, readable structure, correctness provable from source then tests>

## Proof of Completion
${getDelegationBriefDisclosureBlock()}
${getFileReferenceProofOfCompletionExample()}
<evidence the goal was met — list every file you modified>

## Code Change Verification
${CODE_CHANGE_VERIFICATION_CONFIRMATION}

## Blockers / questions
<anything needing planner decision, or "Not Applicable">

## Notes for review
<specific areas for planner to check, or "Not Applicable">
\`\`\``;
}
