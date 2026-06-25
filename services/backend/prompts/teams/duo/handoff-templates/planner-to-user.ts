/**
 * Handoff template: Duo planner → user (final report).
 *
 * This is the most important template in the set: the planner is the single
 * point of contact for the user, and the user can ONLY see the final
 * handoff-to-user message. A high-quality report shapes the planner's goals
 * up-front, which is why this template is delivered eagerly with the user
 * message (see prompts/cli/get-next-task/fullOutput.ts) rather than requiring
 * the agent to fetch it on demand.
 *
 * Every section is mandatory — when one does not apply the planner writes
 * `Not Applicable` rather than omitting it. The report captures not just what
 * changed but the reasoning behind it:
 *  1. Template disclosure confirmation — planner attests they saw this template
 *     at task start before planning or delegating (soft verification for debugging).
 *  2. Proof of principle — how the work adhered to organization/maintainability
 *     and static evaluability/provability principles.
 *  3. Proof of completion — evidence the goal was met (files changed).
 *  4. Key technical decisions — schema design, modules, interfaces, entities.
 *  5. Key tradeoffs — what was weighed and why this path was chosen.
 *  6. Tech debt observed — issues left intentionally out of scope.
 *  7. System design — a mermaid diagram when the change has non-trivial
 *     structure (write "Not Applicable" for trivial changes).
 */

import { getHandoffRecipientVisibilityCallout } from '../../../native/handoff-visibility';

/**
 * Returns the markdown report template the planner uses when delivering the
 * final result to the user.
 */
export function getPlannerToUserReportTemplate(): string {
  return `${getHandoffRecipientVisibilityCallout('user')}

**Report Template (Planner → User)** — fill in EVERY section below in your handoff message. If a section does not apply, write \`Not Applicable\` (do not delete the section):

\`\`\`markdown
## Summary
<what was accomplished, in plain terms — no references to prior messages>

## Template Disclosure Confirmation
- [ ] I confirm that I have seen this template at the start of any planning, before working on or delegating any task to the team

## Proof of Principle
<!-- Demonstrate adherence to:
- Organization & Maintainability: a small change in requirements should result in a small change in code in a small number of files and folders.
- Static Evaluability and Provability: the system's behavior should be provably correct by looking at the source code, then automated tests, then manual tests, in this order.
-->
<how this work follows the principles above — localized changes, readable structure, correctness provable from source then tests>

## Proof of Completion
- \`path/to/file.ts\` — <what changed and why>
<evidence the goal was met — list every file you (or the builder) modified>

## Key Technical Decisions
- <schema design, modules, interfaces, domain entities — what you chose and why, or "Not Applicable">

## Key Tradeoffs
- <what was weighed against what, and why you chose this path, or "Not Applicable">

## Tech Debt Observed
- <issues noticed but intentionally left out of scope of this change, or "Not Applicable">

## System Design
<include a mermaid diagram when the change has non-trivial structure; write "Not Applicable" for trivial changes>

\`\`\`mermaid
flowchart TD
    A[Component] --> B[Component]
\`\`\`

## Verification
- \`pnpm typecheck && pnpm test\` — <result>

## Notes / Next steps
<anything the user should know, follow-ups, or open questions, or "Not Applicable">
\`\`\``;
}
