import { CODE_CHANGE_VERIFICATION_CONFIRMATION } from './code-change-verification';
import { getContextReadDisclosureBlock } from './context-disclosure';
import { getFileReferenceProofOfCompletionExample } from './file-reference-guidance';
import { getHandoffQualityPrinciplesSectionBlock } from './handoff-quality-principles';
import { getHandoffNotApplicableSectionComment } from './handoff-section-guidance';
import { getHandoffSeverityGuidanceBlock } from './handoff-severity-guidance';
import { getProofOfVerificationDisclosureBlock } from './proof-of-verification';
import { getRoleGuidanceDisclosureBlock } from './role-guidance-disclosure';
import { getUnresolvedDecisionsSectionBlock } from './unresolved-decisions';
import type { RoleGuidanceCommandParams } from '../cli/role-guidance/command';

export interface HandoffReportTemplateBodyOptions {
  /** Entry-point handoffs (planner/solo → user) must verify the user's full request before delivery. */
  includeProofOfVerification?: boolean;
}

export function getHandoffReportTemplateBody(
  roleGuidanceContext?: RoleGuidanceCommandParams,
  options: HandoffReportTemplateBodyOptions = {}
): string {
  return `<handoff-overview>
<!-- For informational tasks (summaries, feedback, Q&amp;A with no code changes): put the complete primary answer in Summary and What changed — the user only sees this handoff. -->
## Summary
<what was accomplished, in plain terms — no references to prior messages>

## What changed
<high-level view of what changed since the user's message>
</handoff-overview>

<!-- UI collapses proofs, direction, and notes by default; overview and action required are expanded -->

<handoff-proofs>
## Template Disclosure Confirmation
- [ ] I confirm that I have seen this template at the start of any planning, before working on or delegating any task to the team
${getRoleGuidanceDisclosureBlock(roleGuidanceContext)}

## Proof of Planning
${getHandoffNotApplicableSectionComment('List planning steps for trivial single-step tasks')}
- <step 1: concrete artifact or outcome>
- <step 2: concrete artifact or outcome>

${getHandoffQualityPrinciplesSectionBlock()}

## Proof of Completion
${getContextReadDisclosureBlock(roleGuidanceContext)}
${getFileReferenceProofOfCompletionExample()}
<evidence the goal was met — list every file you (or the builder) modified>

${
  options.includeProofOfVerification
    ? `## Proof of Verification
${getHandoffNotApplicableSectionComment('Entry-point only — write Not Applicable for non-entry roles')}
${getProofOfVerificationDisclosureBlock(roleGuidanceContext)}
- <requirement from user message / context — met or not>
(list each key requirement and evidence: PR URL, commit, or file)
`
    : ''
}
## Backlog Tasks Implemented
${getHandoffNotApplicableSectionComment('List backlog items addressed if none were in scope')}
- \`backlog-item-id\` — <backlog item title/summary and how this work addresses it>

## Backlog Pending User Review Confirmation
${getHandoffNotApplicableSectionComment('Complete the attestation if no backlog items apply')}
- [ ] I confirm that every backlog item implemented in this work has been moved to \`pending_user_review\` via \`chatroom backlog mark-for-review\` after the feature was verified end-to-end and a PR was raised for user review
- PR URL(s): <link to PR(s)>

## Code Change Verification
${CODE_CHANGE_VERIFICATION_CONFIRMATION}
</handoff-proofs>

<handoff-direction>
## What exists today
${getHandoffNotApplicableSectionComment('Describe current state after this work')}
<current state after this work — what the user can now do, what is in place, how the system behaves>

## Key Technical Decisions
${getHandoffNotApplicableSectionComment('List decisions')}
- <schema design, modules, interfaces, domain entities — what you chose and why>

## Key Tradeoffs
${getHandoffNotApplicableSectionComment('List tradeoffs')}
- <what was weighed against what, and why you chose this path>

## System Design
${getHandoffNotApplicableSectionComment('Include a mermaid diagram when the change has non-trivial structure')}

\`\`\`mermaid
flowchart TD
    A[Component] --> B[Component]
\`\`\`
</handoff-direction>

<handoff-notes>
## Notes
${getHandoffNotApplicableSectionComment('Write notes if none')}
<anything the user should know — context, caveats, or observations not covered above>
</handoff-notes>

<handoff-action>
## Tech Debt Observed
${getHandoffNotApplicableSectionComment('List tech debt')}
${getHandoffSeverityGuidanceBlock()}
- <issues noticed but intentionally left out of scope of this change>

${getUnresolvedDecisionsSectionBlock()}

## Manual steps
${getHandoffNotApplicableSectionComment('List manual steps outside the system')}
<steps the user must take outside the system — deploy, configure credentials, run commands, verify in production, etc.>
</handoff-action>`;
}
