/**
 * Handoff template: Squad planner → reviewer (request review brief).
 */

export function getPlannerToReviewerHandoffTemplate(): string {
  return `**Review Request Brief (Planner → Reviewer)** — paste into the handoff message and fill in EVERY field. No field is optional: if a section does not apply, write \`Not Applicable\` (do not delete the section).

\`\`\`markdown
## Goal
<what the reviewer should validate — one sentence>

## Scope
<which slice, feature, or PR surface is under review>

## Files to review (exhaustive)
- \`path/to/file.ts\` — <what changed and what to check>
<list every file the reviewer should inspect>

## Requirements to verify
- <acceptance criterion the reviewer must confirm>
- Verify: \`pnpm typecheck && pnpm test\`

## Focus areas
- <security, edge cases, API contracts, test quality, etc., or "Not Applicable">

## Context / background
<original user request, prior rework rounds, or constraints — or "Not Applicable">

## Out of scope for this review
- <what the reviewer should NOT nitpick or expand, or "Not Applicable">
\`\`\``;
}
