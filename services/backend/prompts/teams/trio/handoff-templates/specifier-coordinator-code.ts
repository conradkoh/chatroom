/**
 * Key: `trio:specifier->coordinator@code` (bucket `code`).
 * Specifier → coordinator round report. Body only: the pair resolver prepends the
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
 * Returns the report the specifier hands to the coordinator after one round: the
 * builder delivered one or more phases and the specifier reviewed them.
 *
 * This is a round report, not an entry-point report: it carries the standards
 * the coordinator needs to write the user report, without the entry-point
 * verification workflow (`user`-facing reports own that).
 */
export function getSpecifierCoordinatorCodeTemplate(query: HandoffTemplateQuery): string {
  return `${getHandoffReportTemplateIntro()}

\`\`\`markdown
## Summary
<what this round delivered, and why the round ended where it did, in plain terms>

## Template Disclosure Confirmation
- [ ] I confirm that I have seen this template at the start of this work package, before driving the builder
${getRoleGuidanceDisclosureBlock({
  chatroomId: query.chatroomId,
  role: query.role,
  cliEnvPrefix: query.cliEnvPrefix,
})}

## What exists today
${getHandoffNotApplicableSectionComment('Describe current state after this round')}
<current state after this round: what the user can now do, what is in place, how the system behaves>

## What this round delivered
<one line per phase: phase id and title, builder handoff message id, commits, files changed, rework rounds>

## Verification run
<what ran at which stage: focused tests per phase, full suite / typecheck / lint / e2e at the round's end, with the command and result>

## What the plan still has
<a reminder for the next round, not an assignment: the phases not yet delivered, in plan order, each with its title; or \`None — the plan is complete.\`>

## Plan reference
Plan ID: <planId> (newly published | unchanged | superseded by <planId>)
Phases delivered so far: <P1, …, Pn>
What remains: <the phases not yet delivered, or \`None — plan complete\`>

${getHandoffQualityPrinciplesSectionBlock('work')}

## Proof of Completion
${getFileReferenceProofOfCompletionExample()}
<for each acceptance criterion in the work package: met / not met / left to a later round, with evidence (test names and output, commands run, commits)>

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
