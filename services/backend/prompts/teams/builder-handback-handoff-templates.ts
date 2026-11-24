import type { HandoffTemplateQuery } from '../cli/handoff-templates/contracts';
import type { RoleGuidanceCommandParams } from '../cli/role-guidance/command';
import { BUILDER_CODE_CHANGE_VERIFICATION_CONFIRMATION } from '../utils/code-change-verification';
import { getDelegationBriefDisclosureBlock } from '../utils/delegation-disclosure';
import { getFileReferenceProofOfCompletionExample } from '../utils/file-reference-guidance';
import { getHandoffQualityPrinciplesSectionBlock } from '../utils/handoff-quality-principles';
import {
  getHandoffNotApplicableSectionComment,
  getHandoffReportTemplateIntro,
} from '../utils/handoff-section-guidance';
import { getRoleGuidanceDisclosureBlock } from '../utils/role-guidance-disclosure';
import { VERIFICATION_KINDS, type VerificationKind } from '../utils/verification-kinds';

function getVerificationKindResultLine(kind: VerificationKind): string {
  const outcomes = kind.lightweight
    ? '<ran: command → result>'
    : "<ran: command → result | not run: reason | not applicable: the brief's reason>";
  return `- \`${kind.label}\` — ${outcomes}`;
}

function getVerificationKindTimingRow(kind: VerificationKind): string {
  return kind.lightweight
    ? `| ${kind.timingLabel} | <duration> |`
    : `| ${kind.timingLabel} | <duration, \`not run\`, or \`not applicable\` |`;
}

/** Timing rows: one per activity, so an activity that did not happen is written `not run`, never omitted. */
function getTimingReportSection(): string {
  return `## Timing report
<!-- REQUIRED. Record the wall-clock duration of each activity you performed, as m:ss or h:mm:ss. Measure with timestamps (for example \`date +%s\` before and after each step). Write \`not run\` for an activity you did not perform and \`not applicable\` when it does not apply to this brief. Do not omit a row. Typecheck and lint always run, so record their duration; if either cannot run, it is a blocker under \`## Blockers / questions\`, not a \`not run\` row. -->
<!-- Ordering: sort the rows that have a duration by duration, descending, so the slowest activity is the first data row. Put each \`not run\` and \`not applicable\` row after the timed rows, in the order listed here. Keep \`Total\` as the last row. Replace the Other activity row with one row per other activity you performed, or with \`| Other activities | not applicable |\` when there were none. -->
| Activity | Duration |
|---|---|
| Brief reading | <duration or \`not run\`> |
| Implementation (code and tests written) | <duration or \`not run\`> |
${VERIFICATION_KINDS.map(getVerificationKindTimingRow).join('\n')}
| Commits | <duration or \`not run\`> |
| Push and PR | <duration, \`not run\`, or \`not applicable\`> |
| Other activity: <activity name> | <duration> |
| Total | <duration> |

Slowest activity and why: <activity name, then one phrase why it was slowest>`;
}

/** Returns the markdown handback template body the builder uses when returning work. */
export function getBuilderHandbackTemplate(query: HandoffTemplateQuery): string {
  const recipientRole = query.toRole;

  return getBuilderHandbackBody(
    {
      chatroomId: query.chatroomId,
      role: query.role,
      cliEnvPrefix: query.cliEnvPrefix,
    },
    recipientRole
  );
}

/** Renders the handback body for a recipient role. */
function getBuilderHandbackBody(
  roleGuidanceContext: RoleGuidanceCommandParams | undefined,
  recipientRole: string
): string {
  return `${getHandoffReportTemplateIntro()}

\`\`\`markdown
## Summary
<what was implemented or attempted, in plain terms>

## Template Disclosure Confirmation
- [ ] I confirm that I have seen this template at the start of this task, before implementing or modifying any code
${getRoleGuidanceDisclosureBlock(roleGuidanceContext)}

${getHandoffQualityPrinciplesSectionBlock()}

## Proof of Completion
${getDelegationBriefDisclosureBlock({ briefSourceRole: recipientRole })}
${getFileReferenceProofOfCompletionExample()}
<evidence the goal was met — list every file you modified; for each behavior the brief's \`## Test seams\` section names a seam for: the test name, the seam it calls, the failure output observed before the implementation, and the passing output after>

## Code Change Verification
${BUILDER_CODE_CHANGE_VERIFICATION_CONFIRMATION}
Record each kind below, in this order, with its command and result. Typecheck and lint always run: record their command and result only. If either cannot run, put the blocker under \`## Blockers / questions\` and do not write \`not run\` here. For every other kind, write \`not run: <reason>\` or \`not applicable: <the brief's reason>\`.
${VERIFICATION_KINDS.map(getVerificationKindResultLine).join('\n')}

${getTimingReportSection()}

## Blockers / questions
${getHandoffNotApplicableSectionComment('List blockers')}
<anything needing ${recipientRole} decision>

## Notes for review
${getHandoffNotApplicableSectionComment('List review notes')}
<specific areas for ${recipientRole} to check; any test written at a seam other than the one the brief's \`## Test seams\` section named, and why>
\`\`\``;
}
