/**
 * Key: `trio:specifier->coordinator@code` (bucket `code`; covers `code` and `code:enhanced`).
 * Specifier → coordinator package report. Body only: the pair resolver prepends the
 * recipient callout and the title line.
 */

import type { HandoffTemplateQuery } from '../../../cli/handoff-templates/contracts';
import { CODE_CHANGE_VERIFICATION_CONFIRMATION } from '../../../utils/code-change-verification';
import { getFileReferenceProofOfCompletionExample } from '../../../utils/file-reference-guidance';
import {
  getHandoffNotApplicableSectionComment,
  getHandoffReportTemplateIntro,
} from '../../../utils/handoff-section-guidance';

/**
 * Returns the report the specifier hands to the coordinator after driving the
 * builder through every slice of a work package.
 */
export function getSpecifierCoordinatorCodeTemplate(_query: HandoffTemplateQuery): string {
  return `${getHandoffReportTemplateIntro()}

\`\`\`markdown
## Summary
<what this work package delivered, or why it stopped>

## Slices delivered
<one entry per builder slice: builder handoff message id, commits, files changed, rework rounds>

## Proof of Completion
${getFileReferenceProofOfCompletionExample()}
<for each acceptance criterion in the work package: met / not met, with evidence (test names and output, commands run, commits)>

## Code Change Verification
${CODE_CHANGE_VERIFICATION_CONFIRMATION}

## Deviations from the work package
${getHandoffNotApplicableSectionComment('List deviations')}
<each place the implementation differs from the package, and why>

## Blockers / questions
${getHandoffNotApplicableSectionComment('List blockers')}
<decisions the coordinator must make, or specialists the coordinator must consult, each with a recommended default>

## Notes for review
${getHandoffNotApplicableSectionComment('List review notes')}
<areas for the coordinator or reviewer to inspect>
\`\`\``;
}
