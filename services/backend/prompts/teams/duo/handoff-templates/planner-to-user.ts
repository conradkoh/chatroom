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
 *  1. Proof — the concrete list of files that were modified.
 *  2. Key technical decisions — schema design, modules, interfaces, entities.
 *  3. Key tradeoffs — what was weighed and why this path was chosen.
 *  4. Tech debt observed — issues left intentionally out of scope.
 *  5. System design — a mermaid diagram when the change has non-trivial
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

## Proof — files changed
- \`path/to/file.ts\` — <what changed and why>
<list every file you (or the builder) modified; this is the evidence of work>

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
