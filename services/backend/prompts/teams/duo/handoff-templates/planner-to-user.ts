/**
 * Handoff template: Duo planner → user (final report).
 *
 * This is the most important template in the set: the planner is the single
 * point of contact for the user, and the user can ONLY see the final
 * handoff-to-user message. A high-quality report shapes the planner's goals
 * up-front, which is why this template is delivered with each task (see
 * prompts/cli/get-next-task/fullOutput.ts and native task delivery) rather
 * than baked into the static init/system prompt.
 *
 * Sections that do not apply may be omitted — the report captures not just
 * what changed but the reasoning behind it:
 *  1. Template disclosure confirmation — planner attests they saw this template
 *     at task start before planning or delegating (soft verification for debugging).
 *  2. What changed — high-level view since the user's message, with proof of
 *     principle and proof of completion as sub-sections.
 *  3. Backlog tasks implemented — backlog items addressed by this work.
 *  4. Backlog pending user review confirmation — attestation that implemented
 *     backlog items were moved to pending_user_review when a PR was raised.
 *  5. Key technical decisions, tradeoffs, tech debt, and system design.
 *  6. Unresolved decisions — open questions carried forward until the user resolves them.
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
 * Returns the markdown report template the planner uses when delivering the
 * final result to the user.
 */
export function getPlannerToUserReportTemplate(
  roleGuidanceContext?: RoleGuidanceCommandParams
): string {
  return `${getHandoffRecipientVisibilityCallout('user')}

${getHandoffReportTemplateIntro('Report Template (Planner → User)')}

\`\`\`markdown
## Summary
<what was accomplished, in plain terms — no references to prior messages>

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
