/**
 * Key: `trio:specifier->coordinator@code` (bucket `code`).
 * Specifier → coordinator package report. Body only: the pair resolver prepends the
 * recipient callout and the title line.
 */

import type { HandoffTemplateQuery } from '../../../cli/handoff-templates/contracts';
import { CODE_CHANGE_VERIFICATION_CONFIRMATION } from '../../../utils/code-change-verification';
import { getFileReferenceProofOfCompletionExample } from '../../../utils/file-reference-guidance';
import { getHandoffQualityPrinciplesSectionBlock } from '../../../utils/handoff-quality-principles';
import {
  getHandoffNotApplicableSectionComment,
  getHandoffReportTemplateIntro,
} from '../../../utils/handoff-section-guidance';
import { getHandoffSeverityGuidanceBlock } from '../../../utils/handoff-severity-guidance';
import { getRoleGuidanceDisclosureBlock } from '../../../utils/role-guidance-disclosure';
import { getUnresolvedDecisionsSectionBlock } from '../../../utils/unresolved-decisions';

/**
 * Returns the report the specifier hands to the coordinator after one package:
 * the builder delivered its single pass and the specifier reviewed it.
 *
 * This is a package report, not an entry-point report: it carries the standards
 * the coordinator needs to review the delivery and re-package what is missing,
 * without the entry-point verification workflow (`user`-facing reports own that).
 */
export function getSpecifierCoordinatorCodeTemplate(query: HandoffTemplateQuery): string {
  return `${getHandoffReportTemplateIntro()}

\`\`\`markdown
## Summary
<what this package delivered, and why it ended where it did, in plain terms>

## Delivery status
<delivered | partial | blocked — one line reason>

## Template Disclosure Confirmation
- [ ] I confirm that I have seen this template at the start of this work package, before briefing the builder
${getRoleGuidanceDisclosureBlock({
  chatroomId: query.chatroomId,
  role: query.role,
  cliEnvPrefix: query.cliEnvPrefix,
})}

## What exists today
${getHandoffNotApplicableSectionComment('Describe current state after this package')}
<current state after this package: what the user can now do, what is in place, how the system behaves>

## What this package delivered
<builder handoff message id, commits, and files changed; for a partial or blocked report, state what did land>

## Not delivered
<requirements not met or not run, each with the file, the line where known, and the failing requirement, and what you recommend the coordinator re-package; or \`None.\`>

## Verification run
<the builder's reported results per verification kind, with command and result, plus your review; anything that did not run and why (blocked or early stop)>

## Plan phases
Plan ID: <planId, or \`None\`>; Phases met: <Pn…>; Phases not met: <Pn…>

${getHandoffQualityPrinciplesSectionBlock('work')}

## Proof of Completion
${getFileReferenceProofOfCompletionExample()}
<for each acceptance criterion in the work package: met / not met / left to a later package, with evidence (test names and output, commands run, commits)>

## Code Change Verification
${CODE_CHANGE_VERIFICATION_CONFIRMATION}

## Key Technical Decisions
${getHandoffNotApplicableSectionComment('List decisions')}
- <schema design, modules, interfaces, domain entities: what you chose and why>

## Key Tradeoffs
${getHandoffNotApplicableSectionComment('List tradeoffs')}
- <what was weighed against what, and why you chose this path>

## Deviations from the work package
${getHandoffNotApplicableSectionComment('List deviations')}
<each place the implementation differs from the package, and why>

## Tech Debt Observed
${getHandoffNotApplicableSectionComment('List tech debt')}
${getHandoffSeverityGuidanceBlock()}
- <issues noticed but intentionally left out of scope of this work package>

${getUnresolvedDecisionsSectionBlock()}

## Manual steps
${getHandoffNotApplicableSectionComment('List manual steps outside the system')}
<steps the user must take outside the system: deploy, configure credentials, run commands, verify in production>

## Notes for review
${getHandoffNotApplicableSectionComment('List review notes')}
<areas for the coordinator or reviewer to inspect>
\`\`\``;
}
