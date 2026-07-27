import { CODE_CHANGE_VERIFICATION_CONFIRMATION } from './code-change-verification';
import { getContextReadDisclosureBlock } from './context-disclosure';
import { getFileReferenceProofOfCompletionExample } from './file-reference-guidance';
import { getHandoffQualityPrinciplesSectionBlock } from './handoff-quality-principles';
import { getHandoffSeverityGuidanceBlock } from './handoff-severity-guidance';
import { getRoleGuidanceDisclosureBlock } from './role-guidance-disclosure';
import { getUnresolvedDecisionsSectionBlock } from './unresolved-decisions';
import type { RoleGuidanceCommandParams } from '../cli/role-guidance/command';

export function getHandoffReportTemplateBody(
  roleGuidanceContext?: RoleGuidanceCommandParams
): string {
  return `<handoff-overview>
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
<!-- REQUIRED. List planning steps, or write "Not Applicable" for trivial single-step tasks. Do not omit this section. -->
- <step 1: concrete artifact or outcome>
- <step 2: concrete artifact or outcome>

${getHandoffQualityPrinciplesSectionBlock()}

## Proof of Completion
${getContextReadDisclosureBlock(roleGuidanceContext)}
${getFileReferenceProofOfCompletionExample()}
<evidence the goal was met — list every file you (or the builder) modified>

## Backlog Tasks Implemented
<!-- REQUIRED. List backlog items addressed, or write "Not Applicable" if none were in scope. Do not omit this section. -->
- \`backlog-item-id\` — <backlog item title/summary and how this work addresses it>

## Backlog Pending User Review Confirmation
<!-- REQUIRED. Complete the attestation, or write "Not Applicable" if no backlog items apply. Do not omit this section. -->
- [ ] I confirm that every backlog item implemented in this work has been moved to \`pending_user_review\` via \`chatroom backlog mark-for-review\` after the feature was verified end-to-end and a PR was raised for user review
- PR URL(s): <link to PR(s)>

## Code Change Verification
${CODE_CHANGE_VERIFICATION_CONFIRMATION}
</handoff-proofs>

<handoff-direction>
## What exists today
<!-- REQUIRED. Describe current state after this work, or write "Not Applicable". Do not omit this section. -->
<current state after this work — what the user can now do, what is in place, how the system behaves>

## Key Technical Decisions
<!-- REQUIRED. List decisions, or write "Not Applicable". Do not omit this section. -->
- <schema design, modules, interfaces, domain entities — what you chose and why>

## Key Tradeoffs
<!-- REQUIRED. List tradeoffs, or write "Not Applicable". Do not omit this section. -->
- <what was weighed against what, and why you chose this path>

## System Design
<!-- REQUIRED. Include a mermaid diagram when the change has non-trivial structure, or write "Not Applicable". Do not omit this section. -->

\`\`\`mermaid
flowchart TD
    A[Component] --> B[Component]
\`\`\`
</handoff-direction>

<handoff-notes>
## Notes
<!-- REQUIRED. Write notes, or "Not Applicable" if none. Do not omit this section. -->
<anything the user should know — context, caveats, or observations not covered above>
</handoff-notes>

<handoff-action>
## Tech Debt Observed
<!-- REQUIRED. List tech debt, or write "Not Applicable". Do not omit this section. -->
${getHandoffSeverityGuidanceBlock()}
- <issues noticed but intentionally left out of scope of this change>

${getUnresolvedDecisionsSectionBlock()}

## Manual steps
<!-- REQUIRED. List manual steps outside the system, or write "Not Applicable". Do not omit this section. -->
<steps the user must take outside the system — deploy, configure credentials, run commands, verify in production, etc.>
</handoff-action>`;
}
