/**
 * Handoff template: Solo → user (final report).
 *
 * The solo agent is both planner and builder — this template shapes goals
 * up-front (template disclosure + proof of planning) and verifies they were
 * met at handoff (context read attestation + proof of completion). Delivered
 * with each task rather than baked into the static init/system prompt.
 *
 * Sections that do not apply may be omitted.
 */

import type { RoleGuidanceCommandParams } from '../../../cli/role-guidance/command';
import { getHandoffRecipientVisibilityCallout } from '../../../native/handoff-visibility';
import { CODE_CHANGE_VERIFICATION_CONFIRMATION } from '../../../utils/code-change-verification';
import { getContextReadDisclosureBlock } from '../../../utils/context-disclosure';
import { getFileReferenceProofOfCompletionExample } from '../../../utils/file-reference-guidance';
import {
  getHandoffQualityPrinciplesCommentBlock,
  PROOF_OF_PRINCIPLES_HEADING_H3,
} from '../../../utils/handoff-quality-principles';
import { getHandoffReportTemplateIntro } from '../../../utils/handoff-section-guidance';
import { getRoleGuidanceDisclosureBlock } from '../../../utils/role-guidance-disclosure';
import { getUnresolvedDecisionsSectionBlock } from '../../../utils/unresolved-decisions';

/**
 * Returns the markdown report template the solo agent uses when delivering
 * the final result to the user.
 */
export function getSoloToUserReportTemplate(
  roleGuidanceContext?: RoleGuidanceCommandParams
): string {
  return `${getHandoffRecipientVisibilityCallout('user')}

${getHandoffReportTemplateIntro('Report Template (Solo → User)')}

\`\`\`markdown
## Summary
<what was accomplished, in plain terms — no references to prior messages>

## Template Disclosure Confirmation
- [ ] I confirm that I have seen this template at the start of any planning, before implementing any code for this task
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
<evidence the goal was met — list every file you modified>

## Backlog Tasks Implemented
- \`backlog-item-id\` — <backlog item title/summary and how this work addresses it>
<Omit if no backlog items were in scope.>

## Backlog Pending User Review Confirmation
- [ ] I confirm that every backlog item implemented in this work has been moved to \`pending_user_review\` via \`chatroom backlog mark-for-review\` because a PR has been raised for user review
- PR URL(s): <link to PR(s)>
<Omit this section if no backlog items apply.>

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

## Code Change Verification
${CODE_CHANGE_VERIFICATION_CONFIRMATION}

${getUnresolvedDecisionsSectionBlock()}

## Notes / Next steps
<anything the user should know, follow-ups, or open questions>
\`\`\``;
}
