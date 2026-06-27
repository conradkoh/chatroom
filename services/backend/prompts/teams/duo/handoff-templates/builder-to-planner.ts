/**
 * Handoff template: Duo builder → planner (work complete / blocked).
 *
 * Every section is mandatory — when one does not apply the builder writes
 * `Not Applicable` rather than omitting it. The handback captures not just
 * what changed but the reasoning behind it:
 *  1. Template disclosure confirmation — builder attests they saw this template
 *     at task start before implementing (soft verification for debugging).
 *  2. Proof of principle — how the work adhered to organization/maintainability
 *     and static evaluability/provability principles.
 *  3. Proof of completion — evidence the delegation goal was met (files changed).
 */

import { getHandoffRecipientVisibilityCallout } from '../../../native/handoff-visibility';

/**
 * Returns the markdown handoff template the builder uses when returning work
 * to the planner.
 */
export function getBuilderToPlannerHandoffTemplate(): string {
  return `${getHandoffRecipientVisibilityCallout('planner')}

**Handoff Template (Builder → Planner)** — paste into the handoff message. Fill in EVERY section below. If a section does not apply, write \`Not Applicable\` (do not delete the section):

\`\`\`markdown
## Summary
<what was implemented or attempted, in plain terms>

## Template Disclosure Confirmation
- [ ] I confirm that I have seen this template at the start of this task, before implementing or modifying any code

## Proof of Principle
<!-- Demonstrate adherence to:
- Organization & Maintainability: a small change in requirements should result in a small change in code in a small number of files and folders.
- Static Evaluability and Provability: the system's behavior should be provably correct by looking at the source code, then automated tests, then manual tests, in this order.
-->
<how this work follows the principles above — localized changes, readable structure, correctness provable from source then tests>

## Proof of Completion
- \`path/to/file.ts\` — <what changed and why>
<evidence the goal was met — list every file you modified>

## Verification
- \`pnpm typecheck && pnpm test\` — <pass/fail + notes>

## Blockers / questions
<anything needing planner decision, or "Not Applicable">

## Notes for review
<specific areas for planner to check, or "Not Applicable">
\`\`\``;
}
