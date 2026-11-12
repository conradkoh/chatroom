/**
 * Key: `trio:specifier->coordinator@code` (bucket `code`).
 * Specifier → coordinator slice report. Body only: the pair resolver prepends the
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
 * Returns the report the specifier hands to the coordinator after the builder
 * delivers ONE slice and the specifier reviews it.
 *
 * This is a slice report, not an entry-point report: it carries the standards
 * the coordinator needs to write the user report, without the entry-point
 * verification workflow (`user`-facing reports own that).
 */
export function getSpecifierCoordinatorCodeTemplate(query: HandoffTemplateQuery): string {
  return `${getHandoffReportTemplateIntro()}

\`\`\`markdown
## Summary
<what this slice delivered, or why it stopped, in plain terms; say which slice of the package this report covers>

## Template Disclosure Confirmation
- [ ] I confirm that I have seen this template at the start of this work package, before driving the builder
${getRoleGuidanceDisclosureBlock({
  chatroomId: query.chatroomId,
  role: query.role,
  cliEnvPrefix: query.cliEnvPrefix,
})}

## What exists today
${getHandoffNotApplicableSectionComment('Describe current state after this slice')}
<current state after this slice: what the user can now do, what is in place, how the system behaves>

## Slice delivered
<the one builder slice this report covers: builder handoff message id, commits, files changed, rework rounds>

## Slices still to do
<the remaining slices of this work package, in build order, each with its goal and the files it touches; or \`None — the package is complete.\`>

${getHandoffQualityPrinciplesSectionBlock('work')}

## Proof of Completion
${getFileReferenceProofOfCompletionExample()}
<for each acceptance criterion in the work package: met / not met / left to a remaining slice, with evidence (test names and output, commands run, commits)>

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
