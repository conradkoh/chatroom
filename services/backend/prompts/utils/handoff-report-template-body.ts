import { CODE_CHANGE_VERIFICATION_CONFIRMATION } from './code-change-verification';
import { getContextReadDisclosureBlock } from './context-disclosure';
import { getFileReferenceProofOfCompletionExample } from './file-reference-guidance';
import {
  getHandoffQualityPrinciplesCommentBlock,
  PROOF_OF_PRINCIPLES_HEADING_H3,
} from './handoff-quality-principles';
import { getRoleGuidanceDisclosureBlock } from './role-guidance-disclosure';
import { getUnresolvedDecisionsSectionBlock } from './unresolved-decisions';
import type { RoleGuidanceCommandParams } from '../cli/role-guidance/command';

export function getHandoffReportTemplateBody(
  roleGuidanceContext?: RoleGuidanceCommandParams
): string {
  return `## Summary
<what was accomplished, in plain terms — no references to prior messages>

<!-- Wrap proof sections in <handoff-proofs> and detail sections in <handoff-details> — UI collapses these by default -->

<handoff-proofs>
## Template Disclosure Confirmation
- [ ] I confirm that I have seen this template at the start of any planning, before working on or delegating any task to the team
${getRoleGuidanceDisclosureBlock(roleGuidanceContext)}

## Proof of Planning
<!-- Demonstrate the goal was decomposed into actionable steps with clear outcomes before implementation. -->
- <step 1: concrete artifact or outcome>
- <step 2: concrete artifact or outcome>
<Omit for trivial single-step tasks.>

## What changed
<high-level view of what changed since the user's message before the detailed proofs below>

${PROOF_OF_PRINCIPLES_HEADING_H3}
${getHandoffQualityPrinciplesCommentBlock()}
<how this work follows the principles above — localized changes, readable structure, correctness provable from source then tests>

### Proof of Completion
${getContextReadDisclosureBlock(roleGuidanceContext)}
${getFileReferenceProofOfCompletionExample()}
<evidence the goal was met — list every file you (or the builder) modified>

## Backlog Tasks Implemented
- \`backlog-item-id\` — <backlog item title/summary and how this work addresses it>
<Omit if no backlog items were in scope.>

## Backlog Pending User Review Confirmation
- [ ] I confirm that every backlog item implemented in this work has been moved to \`pending_user_review\` via \`chatroom backlog mark-for-review\` after the feature was verified end-to-end and a PR was raised for user review
- PR URL(s): <link to PR(s)>
<Omit this section if no backlog items apply.>

## Code Change Verification
${CODE_CHANGE_VERIFICATION_CONFIRMATION}
</handoff-proofs>

<handoff-details>
## Key Technical Decisions
- <schema design, modules, interfaces, domain entities — what you chose and why>

## Key Tradeoffs
- <what was weighed against what, and why you chose this path>

## Tech Debt Observed
- <issues noticed but intentionally left out of scope of this change>

## System Design
<include a mermaid diagram when the change has non-trivial structure; omit for trivial changes>

\`\`\`mermaid
flowchart TD
    A[Component] --> B[Component]
\`\`\`

${getUnresolvedDecisionsSectionBlock()}

## Notes
<anything the user should know — context, caveats, or observations not covered above. Omit if none.>
</handoff-details>`;
}
